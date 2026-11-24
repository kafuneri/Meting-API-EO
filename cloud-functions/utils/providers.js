import crypto from 'node:crypto'

const FETCH_TIMEOUT_MS = 5000
const KUWO_INFO_TIMEOUT_MS = 3500

/**
 * 安全解析酷我搜索接口返回的伪 JSON（单引号键值对等非标准 JSON）
 * @param {string} text 原始响应文本
 * @returns {Record<string, any>}
 */
export function parseKuwoPseudoJson (text) {
  if (!text || typeof text !== 'string') return {}
  const trimmed = text.trim()
  if (!trimmed) return {}

  try {
    return JSON.parse(trimmed)
  } catch {}

  let out = ''
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]

    if (inSingle) {
      if (ch === '\\') {
        const next = trimmed[i + 1]
        if (next === undefined) break
        if (next === "'") {
          out += "'"
        } else if (next === '"') {
          out += '\\"'
        } else if ('"\\/bfnrtu'.includes(next)) {
          out += '\\' + next
        } else {
          out += next
        }
        i++
      } else if (ch === '"') {
        out += '\\"'
      } else if (ch === "'") {
        out += '"'
        inSingle = false
      } else if (ch === '\n') {
        out += '\\n'
      } else if (ch === '\r') {
        out += '\\r'
      } else if (ch === '\t') {
        out += '\\t'
      } else if (ch.charCodeAt(0) < 0x20) {
        out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
      } else {
        out += ch
      }
    } else if (inDouble) {
      out += ch
      if (ch === '\\') {
        const next = trimmed[i + 1]
        if (next !== undefined) {
          out += next
          i++
        }
      } else if (ch === '"') {
        inDouble = false
      }
    } else {
      if (ch === "'") {
        out += '"'
        inSingle = true
      } else {
        if (ch === '"') {
          inDouble = true
        }
        out += ch
      }
    }
  }

  try {
    return JSON.parse(out)
  } catch {
    return {}
  }
}

/**
 * 酷狗音乐高可用解析增强
 * 当上游 @meting/core 遇到版权 VIP 歌曲返回空直链时，自动降级提取官方 60 秒高保真试听切片 (clip_hash)
 */
export async function getKugouUrlWithFallback (hash, targetBr = 320) {
  try {
    const privilegeUrl = 'http://media.store.kugou.com/v1/get_res_privilege'
    const body = JSON.stringify({
      relate: 1,
      userid: '0',
      vip: 0,
      appid: 1000,
      token: '',
      behavior: 'download',
      area_code: '1',
      clientver: '8990',
      resource: [{ id: 0, type: 'audio', hash }]
    })

    const res = await fetch(privilegeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    const json = await res.json()
    const d = json?.data?.[0]
    if (!d) return null

    // 1. 尝试从 relate_goods 中寻找免费完整音频
    if (Array.isArray(d.relate_goods) && d.relate_goods.length > 0) {
      for (const item of d.relate_goods) {
        if (!item?.hash) continue
        const itemBr = item.info?.bitrate || 128
        if (itemBr <= targetBr) {
          const key = crypto.createHash('md5').update(item.hash + 'kgcloudv2').digest('hex')
          const trackerUrl = `http://trackercdn.kugou.com/i/v2/?hash=${item.hash}&key=${key}&pid=3&behavior=play&cmd=25&version=8990`
          const tRes = await fetch(trackerUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
          })
          const tJson = await tRes.json()
          if (tJson.status === 1 && Array.isArray(tJson.url) && tJson.url[0]) {
            return {
              url: tJson.url[0],
              size: tJson.fileSize || 0,
              br: (tJson.bitRate || 128000) / 1000
            }
          }
        }
      }
    }

    // 2. VIP 付费歌曲兜底：提取官方 60 秒试听切片 (clip_hash)
    const clipHash = d?.trans_param?.hash_offset?.clip_hash || d?.trans_param?.offset_hash
    if (clipHash) {
      const key = crypto.createHash('md5').update(clipHash + 'kgcloudv2').digest('hex')
      const trackerUrl = `http://trackercdn.kugou.com/i/v2/?hash=${clipHash}&key=${key}&pid=3&behavior=play&cmd=25&version=8990`
      const tRes = await fetch(trackerUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      const tJson = await tRes.json()
      if (tJson.status === 1 && Array.isArray(tJson.url) && tJson.url[0]) {
        return {
          url: tJson.url[0],
          size: tJson.fileSize || 0,
          br: (tJson.bitRate || 128000) / 1000,
          isClip: true
        }
      }
    }
  } catch (err) {
    console.error('Kugou fallback error:', err.message)
  }
  return null
}

/**
 * 酷我音乐独立高可用适配器
 * 避开 @meting/core 中因 PC Web 端防爬（过期 kw_token / cookie）导致的 illegal request 报错
 */
export const kuwoProvider = {
  async search (keyword, page = 1, limit = 30) {
    const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&uid=794762323&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newsearch=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    const text = await res.text()
    const data = parseKuwoPseudoJson(text)
    const list = data?.abslist || []
    return list.map(item => {
      const id = (item.DC_TARGETID || item.MUSICRID || '').replace('MUSIC_', '')
      const artists = (item.ARTIST || item.AARTIST || 'Unknown').replace(/&nbsp;/g, ' ').split('&')
      return {
        id,
        name: (item.SONGNAME || item.NAME || '').replace(/&nbsp;/g, ' '),
        artist: artists,
        album: (item.ALBUM || '').replace(/&nbsp;/g, ' '),
        pic_id: id,
        url_id: id,
        lyric_id: id,
        source: 'kuwo'
      }
    })
  },

  async song (id) {
    const info = await this._getSongInfo(id)
    const song = info?.songinfo
    if (song) {
      let songName = song.songName || ''
      if (!songName && Array.isArray(info?.lrclist) && info.lrclist.length > 0) {
        const firstLine = info.lrclist[0].lineLyric || ''
        const parts = firstLine.split(' - ')
        songName = parts[0]?.trim() || firstLine.trim()
      }
      return {
        id: String(song.id || id),
        name: songName || 'Kuwo Music',
        artist: song.artist ? song.artist.split('&') : ['Unknown'],
        album: song.album || '',
        pic_id: String(song.id || id),
        url_id: String(song.id || id),
        lyric_id: String(song.id || id),
        source: 'kuwo'
      }
    }
    // 兜底返回基础结构
    return {
      id: String(id),
      name: 'Kuwo Music',
      artist: ['Unknown'],
      album: '',
      pic_id: String(id),
      url_id: String(id),
      lyric_id: String(id),
      source: 'kuwo'
    }
  },

  async url (id) {
    const url = `http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${id}&format=mp3&response=url`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    const playUrl = (await res.text()).trim()
    if (playUrl && playUrl.startsWith('http')) {
      return { url: playUrl, br: 128 }
    }
    return { url: '', br: -1 }
  },

  async pic (id) {
    const info = await this._getSongInfo(id)
    let pic = info?.songinfo?.pic || info?.songinfo?.pic120 || ''
    if (pic) {
      pic = pic.replace('http://img1.kwcdn.kuwo.cn', 'https://img4.kuwo.cn')
               .replace('http://', 'https://')
      return { url: pic }
    }
    return { url: '' }
  },

  async lyric (id) {
    const info = await this._getSongInfo(id)
    const list = info?.lrclist || []
    let lrc = ''
    for (const item of list) {
      const sec = parseFloat(item.time)
      if (!isNaN(sec)) {
        const m = Math.floor(sec / 60).toString().padStart(2, '0')
        const s = Math.floor(sec % 60).toString().padStart(2, '0')
        const ms = (sec % 1 * 100).toFixed(0).padStart(2, '0')
        lrc += `[${m}:${s}.${ms}]${item.lineLyric}\n`
      }
    }
    return { lyric: lrc, tlyric: '' }
  },

  async _getSongInfo (id) {
    const urls = [
      `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${id}`,
      `http://kuwo.cn/newh5/singles/songinfoandlrc?musicId=${id}`
    ]
    for (const url of urls) {
      let cookie = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
              'Referer': 'https://m.kuwo.cn/',
              ...(cookie ? { Cookie: cookie } : {})
            },
            signal: AbortSignal.timeout(KUWO_INFO_TIMEOUT_MS)
          })
          const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]
          if (setCookies && setCookies.length > 0) {
            cookie = setCookies.filter(Boolean).map(c => c.split(';')[0]).join('; ')
          }
          const json = await res.json()
          if (json?.status === 200 && json?.data) {
            return json.data
          }
        } catch {}
      }
    }
    return {}
  }
}
