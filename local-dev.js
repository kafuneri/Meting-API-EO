import express from 'express'
import { resolve } from 'node:path'
import app from './cloud-functions/[[default]].js'

// 本地开发静态文件映射
app.use(express.static('public'))

app.get('/test', (req, res) => {
  res.sendFile(resolve('public/test.html'))
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[Local Dev] Meting-API EO server running on: http://localhost:${PORT}`)
  console.log(`[Local Dev] API endpoint: http://localhost:${PORT}/api`)
  console.log(`[Local Dev] Demo page: http://localhost:${PORT}/index.html`)
  console.log(`[Local Dev] Test page: http://localhost:${PORT}/test`)
})
