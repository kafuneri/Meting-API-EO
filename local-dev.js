import express from 'express'
import { resolve } from 'node:path'
import apiApp from './cloud-functions/[[default]].js'

const app = express()

// 本地开发优先匹配 public 静态资源
app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendFile(resolve('public/index.html'))
})

app.get('/test', (req, res) => {
  res.sendFile(resolve('public/test.html'))
})

// 其他请求（如 /api, /health）由云函数应用统一接管
app.use(apiApp)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[Local Dev] Meting-API EO server running on: http://localhost:${PORT}`)
  console.log(`[Local Dev] API endpoint: http://localhost:${PORT}/api`)
  console.log(`[Local Dev] Demo page: http://localhost:${PORT}/index.html`)
  console.log(`[Local Dev] Test page: http://localhost:${PORT}/test`)
})
