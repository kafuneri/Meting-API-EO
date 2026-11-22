import express from 'express'
import app from './cloud-functions/[[default]].js'

// 本地开发静态文件映射
app.use(express.static('public'))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[Local Dev] Meting-API EO server running on: http://localhost:${PORT}`)
  console.log(`[Local Dev] API endpoint: http://localhost:${PORT}/api`)
  console.log(`[Local Dev] Demo page: http://localhost:${PORT}/index.html`)
})
