import app from './cloud-functions/[[default]].js'
import http from 'node:http'

const server = http.createServer(app)

async function runTests () {
  await new Promise(resolve => server.listen(3333, resolve))
  console.log('--- Starting Local Automated Tests on http://localhost:3333 ---')

  let passCount = 0
  let failCount = 0

  async function testCase (name, path, validate) {
    try {
      const res = await fetch(`http://localhost:3333${path}`, { redirect: 'manual' })
      const ok = await validate(res)
      if (ok) {
        console.log(`[PASS] ${name}`)
        passCount++
      } else {
        console.error(`[FAIL] ${name} - Validation returned false (status: ${res.status})`)
        failCount++
      }
    } catch (err) {
      console.error(`[ERROR] ${name} - ${err.message}`)
      failCount++
    }
  }

  // 1. 健康检查
  await testCase('Health Check (/health)', '/health', async res => {
    const json = await res.json()
    return res.status === 200 && json.status === 'ok'
  })

  // 2. 参数非法校验 (server 不合法)
  await testCase('Invalid server param handling', '/api?server=unknown&type=song&id=1', async res => {
    return res.status === 400
  })

  // 3. 参数非法校验 (type 不合法)
  await testCase('Invalid type param handling', '/api?server=netease&type=invalid&id=1', async res => {
    return res.status === 400
  })

  // 4. 网易云 ACG 歌单解析 (playlist - 云音乐ACG音乐榜 71385702)
  await testCase('NetEase ACG Playlist (/api?server=netease&type=playlist&id=71385702)', '/api?server=netease&type=playlist&id=71385702', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title && json[0].url
  })

  // 5. 网易云单曲直链 (302 Redirect)
  await testCase('NetEase Song URL Redirect 302 (/api?server=netease&type=url&id=35847388)', '/api?server=netease&type=url&id=35847388', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.startsWith('https://')
  })

  // 6. 网易云歌词解析 (lrc)
  await testCase('NetEase Lyric Parsing (/api?server=netease&type=lrc&id=35847388)', '/api?server=netease&type=lrc&id=35847388', async res => {
    if (res.status !== 200) return false
    const text = await res.text()
    return text.includes('[') && text.includes(']')
  })

  // 7. 网易云封面图直链 (302 Redirect)
  await testCase('NetEase Pic Redirect 302 (/api?server=netease&type=pic&id=35847388)', '/api?server=netease&type=pic&id=35847388', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.length > 0
  })

  // 8. QQ音乐歌单解析 (playlist - 7326220405)
  await testCase('Tencent Playlist (/api?server=tencent&type=playlist&id=7326220405)', '/api?server=tencent&type=playlist&id=7326220405', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title
  })

  // 9. 酷狗搜索 (kugou search)
  await testCase('Kugou Search (/api?server=kugou&type=search&id=周杰伦)', '/api?server=kugou&type=search&id=%E5%91%A8%E6%9D%B0%E4%BC%A6', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title
  })

  // 10. 酷狗 VIP 歌曲播放链接兜底 (kugou url with clip fallback)
  await testCase('Kugou VIP Song URL Redirect 302 (/api?server=kugou&type=url&id=a14373681262867ab43fef5467f4cc1d)', '/api?server=kugou&type=url&id=a14373681262867ab43fef5467f4cc1d', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.startsWith('https://')
  })

  // 11. 酷我搜索 (kuwo search)
  await testCase('Kuwo Search (/api?server=kuwo&type=search&id=周杰伦)', '/api?server=kuwo&type=search&id=%E5%91%A8%E6%9D%B0%E4%BC%A6', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title === '晴天'
  })

  // 12. 酷我播放直链 (kuwo url redirect)
  await testCase('Kuwo Song URL Redirect 302 (/api?server=kuwo&type=url&id=228908)', '/api?server=kuwo&type=url&id=228908', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.startsWith('https://')
  })

  // 13. 酷我歌词解析 (kuwo lrc)
  await testCase('Kuwo Lyric Parsing (/api?server=kuwo&type=lrc&id=228908)', '/api?server=kuwo&type=lrc&id=228908', async res => {
    if (res.status !== 200) return false
    const text = await res.text()
    return text.includes('[') && text.includes('晴天')
  })

  // 14. 百度已彻底移除支持校验 (baidu server removed, returns 400)
  await testCase('Baidu Removed Server Rejection (/api?server=baidu&type=search&id=周杰伦)', '/api?server=baidu&type=search&id=%E5%91%A8%E6%9D%B0%E4%BC%A6', async res => {
    return res.status === 400
  })

  console.log(`\n=== Test Results: ${passCount} passed, ${failCount} failed ===\n`)
  server.close()
  if (failCount > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})
