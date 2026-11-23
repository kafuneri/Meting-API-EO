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

const portArgIndex = process.argv.findIndex(arg => arg === '--port' || arg === '-p')
const cliPort = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : null
const PORT = process.env.PORT || cliPort || 3000

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Local Dev] Meting-API EO server running on: http://0.0.0.0:${PORT}`)
  console.log(`[Local Dev] Local:   http://localhost:${PORT}`)
  console.log(`[Local Dev] Network: http://192.168.8.222:${PORT}`)
  console.log(`[Local Dev] Test:    http://192.168.8.222:${PORT}/test`)
})
