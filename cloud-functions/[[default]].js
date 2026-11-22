import express from 'express'
import cors from 'cors'
import { createHmac } from 'node:crypto'
import Meting from '@meting/core'
import { LRUCache } from 'lru-cache'
import { formatLyric } from './utils/lyric.js'
import { getKugouUrlWithFallback, kuwoProvider } from './utils/providers.js'
import { createCorsOriginChecker } from './utils/cors.js'

const app = express()

// 开启 CORS 跨域支持（支持 CORS_ORIGIN 环境变量：单域名、多域名逗号分隔及泛域名通配符 *.example.com，默认 *）
app.use(cors({
  origin: createCorsOriginChecker(),
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

// LRU 内存缓存（函数实例温启动期间复用，避免频繁向上游请求）
const cache = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 30 // 默认缓存 30 分钟
})

const METING_METHODS = {
  search: 'search',
  song: 'song',
  album: 'album',
  artist: 'artist',
  playlist: 'playlist',
  lrc: 'lyric',
  url: 'url',
  pic: 'pic'
}

const SUPPORTED_SERVERS = ['netease', 'tencent', 'kugou', 'kuwo']
const SUPPORTED_TYPES = ['song', 'album', 'search', 'artist', 'playlist', 'lrc', 'url', 'pic']

function signToken (server, type, id, secret) {
  return createHmac('sha1', secret).update(`${server}${type}${id}`).digest('hex')
}

function getBaseUrl (req) {
  if (process.env.METING_URL) {
    return process.env.METING_URL.replace(/\/+$/, '')
  }
  const isInternal = (h) => !h || h.includes('.qcloudteo.com') || h.includes('.tencentscf.com')

  // 1. EdgeOne Pages 官方加速域名专属请求头（包含自定义域名如 meting-api.kafuchino.top 与预设域名）
  const eoHost = req.headers['eo-pages-host']
  if (eoHost && !isInternal(eoHost)) {
    return `https://${eoHost}`
  }

  // 2. 检查反向代理 / CDN 传递的公网 Host
  const forwardedHost = req.headers['x-forwarded-host'] || 
                        req.headers['x-real-host'] || 
                        req.headers['x-original-host'] || ''
  if (forwardedHost && !isInternal(forwardedHost)) {
    const proto = req.headers['x-forwarded-proto'] || 'https'
    return `${proto}://${forwardedHost}`
  }

  // 3. 检查普通 Host（排除 SCF 内部集群域名）
  const host = req.get('host')
  if (host && !isInternal(host)) {
    const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
  }

  // 4. 兜底返回相对路径
  return ''
}

// 辅助函数：格式化网易云原始歌曲对象为标准 Meting 数据规范
function formatNetEaseSong (t) {
  const e = {
    id: t.id,
    name: t.name,
    artist: [],
    album: t.al?.name || '',
    pic_id: t.al?.pic_str || t.al?.pic || t.id,
    url_id: t.id,
    lyric_id: t.id,
    source: 'netease'
  }
  if (t.al?.picUrl) {
    const r = t.al.picUrl.match(/\/(\d+)\./)
    if (r) e.pic_id = r[1]
  }
  if (t.ar) {
    t.ar.forEach(a => { e.artist.push(a.name) })
  }
  return e
}

// 辅助函数：判断是否启用 VIP 歌曲过滤（无 Cookie 状态下默认 true 开启，可通过环境变量 FILTER_VIP=false 或 query 参数 filter_vip=false 关闭）
function isVipFilterActive (req, hasCookie) {
  if (hasCookie) return false
  if (req.query.filter_vip !== undefined) {
    return !['false', '0', 'no', 'off'].includes(String(req.query.filter_vip).trim().toLowerCase())
  }
  const envVal = process.env.FILTER_VIP ?? process.env.METING_FILTER_VIP
  if (envVal !== undefined) {
    return !['false', '0', 'no', 'off'].includes(String(envVal).trim().toLowerCase())
  }
  return true
}

async function handleMetingRequest (req, res) {
  // 1. 获取并清洗参数
  const server = (req.query.server || 'netease').toString().toLowerCase()
  const type = (req.query.type || 'playlist').toString().toLowerCase()
  const defaultId = server === 'netease' ? '71385702' : (server === 'kuwo' ? '228908' : '7326220405')
  const id = (req.query.id || defaultId).toString()
  const token = req.query.token || req.query.auth || ''

  // 2. 参数合法性校验
  if (!SUPPORTED_SERVERS.includes(server)) {
    return res.status(400).json({ error: `server 参数不合法，支持: ${SUPPORTED_SERVERS.join(', ')}` })
  }
  if (!SUPPORTED_TYPES.includes(type)) {
    return res.status(400).json({ error: `type 参数不合法，支持: ${SUPPORTED_TYPES.join(', ')}` })
  }

  // 3. HMAC-SHA1 鉴权（如果配置了 METING_TOKEN 环境变量）
  const secretToken = process.env.METING_TOKEN
  if (secretToken && ['lrc', 'url', 'pic'].includes(type)) {
    const expected = signToken(server, type, id, secretToken)
    if (token !== expected) {
      return res.status(401).json({ error: '鉴权失败，签名不匹配' })
    }
  }

  // 读取对应平台的 Cookie 并判断 VIP 过滤开关
  const cookieEnvKey = `METING_COOKIE_${server.toUpperCase()}`
  const cookie = process.env[cookieEnvKey] || process.env.METING_COOKIE
  const filterVip = isVipFilterActive(req, !!cookie)

  // 4. 读取缓存或调用上游 API（cacheKey 带有 filterVip 状态，避免状态切换命中旧缓存）
  const cacheKey = `${server}:${type}:${id}:${filterVip ? 'fv1' : 'fv0'}`
  let data = cache.get(cacheKey)

  if (data === undefined) {
    try {
      if (server === 'kuwo') {
        // 酷我音乐独立适配器
        if (type === 'search') {
          data = await kuwoProvider.search(id)
        } else if (type === 'song') {
          data = await kuwoProvider.song(id)
        } else if (type === 'url') {
          data = await kuwoProvider.url(id)
        } else if (type === 'pic') {
          data = await kuwoProvider.pic(id)
        } else if (type === 'lrc') {
          data = await kuwoProvider.lyric(id)
        } else {
          // playlist, album, artist
          data = await kuwoProvider.search(id)
        }
      } else {
        // 网易云 / QQ音乐 / 酷狗音乐 使用 @meting/core
        const meting = new Meting(server)

        if (cookie) {
          meting.cookie(cookie)
        }

        if (server === 'netease' && type === 'artist' && filterVip) {
          // 歌手热门曲目：无 VIP Cookie 且开启过滤时优先筛选 fee === 0 或 8 的完整非 VIP 音轨（避免 30s 试听片段置顶）
          const raw = await meting.format(false).artist(id, 50)
          const json = JSON.parse(raw)
          const allSongs = json.hotSongs || []
          const freeSongs = allSongs.filter(s => s.fee === 0 || s.fee === 8)
          const targetSongs = freeSongs.length > 0 ? freeSongs : allSongs
          data = targetSongs.map(formatNetEaseSong)
        } else if (server === 'netease' && type === 'search' && filterVip) {
          // 搜索结果：无 VIP Cookie 且开启过滤时优先筛选 fee === 0 或 8 的非 VIP 音轨
          const raw = await meting.format(false).search(id, { limit: 30 })
          const json = JSON.parse(raw)
          const allSongs = json.result?.songs || []
          const freeSongs = allSongs.filter(s => s.fee === 0 || s.fee === 8)
          const targetSongs = freeSongs.length > 0 ? freeSongs : allSongs
          data = targetSongs.map(formatNetEaseSong)
        } else {
          meting.format(true)
          const method = METING_METHODS[type]
          const rawResponse = await meting[method](id)
          data = JSON.parse(rawResponse)
        }

        // 酷狗音乐：当遇到 VIP 版权歌曲返回空直链时，自动提取 60s 试听切片兜底
        if (server === 'kugou' && type === 'url' && (!data || !data.url)) {
          const fallback = await getKugouUrlWithFallback(id)
          if (fallback?.url) {
            data = fallback
          }
        }
      }

      // url 缓存 10 分钟，其他元数据缓存 1 小时
      const ttl = type === 'url' ? 1000 * 60 * 10 : 1000 * 60 * 60
      cache.set(cacheKey, data, { ttl })
      res.setHeader('x-cache', 'miss')
    } catch (err) {
      return res.status(500).json({
        error: '上游音乐平台 API 请求失败',
        message: err.message
      })
    }
  } else {
    res.setHeader('x-cache', 'hit')
  }

  // 6. 组装并返回结果
  const baseUrl = getBaseUrl(req)

  // 6.1 音频直链 302 重定向
  if (type === 'url') {
    let playUrl = data?.url
    if (!playUrl) {
      return res.status(404).send('Audio Not Found')
    }
    // 平台链接纠偏与强制 HTTPS
    if (server === 'netease') {
      playUrl = playUrl
        .replace('://m7c.', '://m7.')
        .replace('://m8c.', '://m8.')
        .replace('http://', 'https://')
    } else if (server === 'tencent') {
      playUrl = playUrl
        .replace('http://', 'https://')
        .replace('://ws.stream.qqmusic.qq.com', '://dl.stream.qqmusic.qq.com')
    } else if (server === 'kugou' || server === 'kuwo') {
      playUrl = playUrl.replace('http://', 'https://')
    }
    return res.redirect(302, playUrl)
  }

  // 6.2 封面图片 302 重定向
  if (type === 'pic') {
    let picUrl = data?.url
    if (!picUrl) {
      return res.status(404).send('Cover Picture Not Found')
    }
    if (server === 'kuwo') {
      picUrl = picUrl.replace('http://img1.kwcdn.kuwo.cn', 'https://img4.kuwo.cn')
                     .replace('http://', 'https://')
    } else if (server === 'kugou') {
      picUrl = picUrl.replace('http://', 'https://')
    }
    return res.redirect(302, picUrl)
  }

  // 6.3 歌词返回（双语时间轴对齐合并）
  if (type === 'lrc') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.send(formatLyric(data?.lyric, data?.tlyric))
  }

  // 6.4 歌曲列表/单曲（格式化为 MetingJS / APlayer 标准数据规范）
  const list = Array.isArray(data) ? data : [data]
  const formatted = list.map(item => {
    const authUrl = secretToken ? `&auth=${signToken(server, 'url', item.url_id, secretToken)}` : ''
    const authPic = secretToken ? `&auth=${signToken(server, 'pic', item.pic_id, secretToken)}` : ''
    const authLrc = secretToken ? `&auth=${signToken(server, 'lrc', item.lyric_id, secretToken)}` : ''

    return {
      title: item.name || '',
      author: Array.isArray(item.artist) ? item.artist.join(' / ') : (item.artist || 'Unknown'),
      url: `${baseUrl}/api?server=${server}&type=url&id=${item.url_id}${authUrl}`,
      pic: `${baseUrl}/api?server=${server}&type=pic&id=${item.pic_id}${authPic}`,
      lrc: `${baseUrl}/api?server=${server}&type=lrc&id=${item.lyric_id}${authLrc}`
    }
  })

  return res.json(formatted)
}

// 路由挂载
app.get(['/health', '/api/health'], (req, res) => {
  res.json({ status: 'ok', provider: 'Tencent Cloud EdgeOne Pages Cloud Functions', timestamp: Date.now() })
})

// 兼容所有路径（/api, /api/*, / 等），由 handleMetingRequest 处理
app.all('*', handleMetingRequest)

// 导出 app 实例供 EdgeOne Pages 托管调用
export default app
