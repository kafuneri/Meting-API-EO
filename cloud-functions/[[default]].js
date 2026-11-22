import express from 'express'
import cors from 'cors'
import { createHmac } from 'node:crypto'
import Meting from '@meting/core'
import { LRUCache } from 'lru-cache'
import { formatLyric } from './utils/lyric.js'

const app = express()

// 开启 CORS 跨域支持
app.use(cors({
  origin: '*',
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

const SUPPORTED_SERVERS = ['netease', 'tencent', 'kugou', 'baidu', 'kuwo']
const SUPPORTED_TYPES = ['song', 'album', 'search', 'artist', 'playlist', 'lrc', 'url', 'pic']

function signToken (server, type, id, secret) {
  return createHmac('sha1', secret).update(`${server}${type}${id}`).digest('hex')
}

function getBaseUrl (req) {
  if (process.env.METING_URL) {
    return process.env.METING_URL.replace(/\/+$/, '')
  }
  const host = req.get('host') || 'localhost'
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https'
  return `${protocol}://${host}`
}

async function handleMetingRequest (req, res) {
  // 1. 获取并清洗参数
  const server = (req.query.server || 'netease').toString().toLowerCase()
  const type = (req.query.type || 'playlist').toString().toLowerCase()
  const defaultId = server === 'netease' ? '19723756' : '7326220405'
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

  // 4. 读取缓存或调用上游 API
  const cacheKey = `${server}:${type}:${id}`
  let data = cache.get(cacheKey)

  if (data === undefined) {
    try {
      const meting = new Meting(server)
      meting.format(true)

      // 注入对应平台的 Cookie（如配置了环境变量）
      const cookieEnvKey = `METING_COOKIE_${server.toUpperCase()}`
      const cookie = process.env[cookieEnvKey] || process.env.METING_COOKIE
      if (cookie) {
        meting.cookie(cookie)
      }

      const method = METING_METHODS[type]
      const rawResponse = await meting[method](id)
      data = JSON.parse(rawResponse)

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

  // 5. 组装并返回结果
  const baseUrl = getBaseUrl(req)

  // 5.1 音频直链 302 重定向
  if (type === 'url') {
    let playUrl = data.url
    if (!playUrl) {
      return res.status(404).send('Audio Not Found')
    }
    // 平台链接纠偏与强制 HTTPS
    if (server === 'netease') {
      playUrl = playUrl
        .replace('://m7c.', '://m7.')
        .replace('://m8c.', '://m8.')
        .replace('http://', 'https://')
      if (playUrl.includes('vuutv=')) {
        try {
          const u = new URL(playUrl)
          u.search = ''
          playUrl = u.toString()
        } catch {}
      }
    } else if (server === 'tencent') {
      playUrl = playUrl
        .replace('http://', 'https://')
        .replace('://ws.stream.qqmusic.qq.com', '://dl.stream.qqmusic.qq.com')
    } else if (server === 'baidu') {
      playUrl = playUrl.replace(
        'http://zhangmenshiting.qianqian.com',
        'https://gss3.baidu.com/y0s1hSulBw92lNKgpU_Z2jR7b2w6buu'
      )
    }
    return res.redirect(302, playUrl)
  }

  // 5.2 封面图片 302 重定向
  if (type === 'pic') {
    const picUrl = data.url
    if (!picUrl) {
      return res.status(404).send('Cover Picture Not Found')
    }
    return res.redirect(302, picUrl)
  }

  // 5.3 歌词返回（双语时间轴对齐合并）
  if (type === 'lrc') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.send(formatLyric(data.lyric, data.tlyric))
  }

  // 5.4 歌曲列表/单曲（格式化为 MetingJS / APlayer 标准数据规范）
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
app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: 'Tencent Cloud EdgeOne Pages Cloud Functions', timestamp: Date.now() })
})

// 兼容所有路径（/api, /api/*, / 等），由 handleMetingRequest 处理
app.all('*', handleMetingRequest)

// 导出 app 实例供 EdgeOne Pages 托管调用
export default app
