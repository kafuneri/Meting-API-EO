import app from './cloud-functions/[[default]].js'
import { parseCorsPatterns, isOriginAllowed } from './cloud-functions/utils/cors.js'
import { parseKuwoPseudoJson } from './cloud-functions/utils/providers.js'
import http from 'node:http'

const server = http.createServer(app)

async function runTests () {
  await new Promise(resolve => server.listen(3333, resolve))
  console.log('--- Starting Local Automated Tests on http://localhost:3333 ---')

  let passCount = 0
  let failCount = 0

  async function testCase (name, path, validate, fetchOptions = {}) {
    try {
      const res = await fetch(`http://localhost:3333${path}`, { redirect: 'manual', ...fetchOptions })
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

  // 1. 健康检查（含脱敏配置状态与 Cache-Control）
  await testCase('Health Check (/health)', '/health', async res => {
    const json = await res.json()
    const cc = res.headers.get('cache-control')
    return (
      res.status === 200 &&
      json.status === 'ok' &&
      cc === 'no-store' &&
      typeof json.config?.authEnabled === 'boolean' &&
      typeof json.config?.cookies?.netease === 'boolean' &&
      typeof json.config?.defaultBr === 'number' &&
      typeof json.cache?.entries === 'number'
    )
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
  await testCase('NetEase Song URL Redirect 302 (/api?server=netease&type=url&id=509106775)', '/api?server=netease&type=url&id=509106775', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.startsWith('https://')
  })

  // 6. 网易云歌词解析 (lrc)
  await testCase('NetEase Lyric Parsing (/api?server=netease&type=lrc&id=509106775)', '/api?server=netease&type=lrc&id=509106775', async res => {
    if (res.status !== 200) return false
    const text = await res.text()
    return text.includes('[') && text.includes(']')
  })

  // 7. 网易云封面图直链 (302 Redirect)
  await testCase('NetEase Pic Redirect 302 (/api?server=netease&type=pic&id=509106775)', '/api?server=netease&type=pic&id=509106775', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.length > 0
  })

  // 8. 网易云歌手精选过滤VIP (artist - 鹿乃 17014 默认 filter_vip=true，心做し置顶)
  await testCase('NetEase Artist Kano Default Filter VIP (/api?server=netease&type=artist&id=17014)', '/api?server=netease&type=artist&id=17014', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title === '心做し'
  })

  // 8b. 网易云歌手精选取消过滤VIP (filter_vip=false，原始置顶为 VIP 歌曲 Memories of Kindness)
  await testCase('NetEase Artist Kano Cancel Filter VIP (/api?server=netease&type=artist&id=17014&filter_vip=false)', '/api?server=netease&type=artist&id=17014&filter_vip=false', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title === 'Memories of Kindness'
  })

  // 9. QQ音乐歌单解析 (playlist - 7326220405)
  await testCase('Tencent Playlist (/api?server=tencent&type=playlist&id=7326220405)', '/api?server=tencent&type=playlist&id=7326220405', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title
  })

  // 9. 酷狗非VIP单曲解析 (kugou song - 卡农 文武贝)
  await testCase('Kugou Free Song (/api?server=kugou&type=song&id=1466d9ee60b499811a2d2ef9eaa664a9)', '/api?server=kugou&type=song&id=1466d9ee60b499811a2d2ef9eaa664a9', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title === '卡农'
  })

  // 10. 酷狗非VIP歌曲直链 (kugou url)
  await testCase('Kugou Free Song URL Redirect 302 (/api?server=kugou&type=url&id=1466d9ee60b499811a2d2ef9eaa664a9)', '/api?server=kugou&type=url&id=1466d9ee60b499811a2d2ef9eaa664a9', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.startsWith('https://')
  })

  // 11. 酷我非VIP单曲解析 (kuwo song - 卡农 文武贝)
  await testCase('Kuwo Free Song (/api?server=kuwo&type=song&id=158975210)', '/api?server=kuwo&type=song&id=158975210', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].title.includes('卡农')
  })

  // 12. 酷我非VIP播放直链 (kuwo url redirect)
  await testCase('Kuwo Free Song URL Redirect 302 (/api?server=kuwo&type=url&id=158975210)', '/api?server=kuwo&type=url&id=158975210', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.startsWith('https://')
  })

  // 13. 酷我非VIP歌词解析 (kuwo lrc - 卡农)
  await testCase('Kuwo Lyric Parsing (/api?server=kuwo&type=lrc&id=158975210)', '/api?server=kuwo&type=lrc&id=158975210', async res => {
    if (res.status !== 200) return false
    const text = await res.text()
    return text.includes('[') && text.includes('卡农')
  })

  // 14. 百度已彻底移除支持校验 (baidu server removed, returns 400)
  await testCase('Baidu Removed Server Rejection (/api?server=baidu&type=search&id=周杰伦)', '/api?server=baidu&type=search&id=%E5%91%A8%E6%9D%B0%E4%BC%A6', async res => {
    return res.status === 400
  })

  // 15. CORS 默认通配符模式 (*) 测试
  await testCase('CORS Default Wildcard (*) with Origin header', '/health', async res => {
    const acao = res.headers.get('access-control-allow-origin')
    return res.status === 200 && (acao === '*' || acao === 'https://foo.com')
  }, { headers: { Origin: 'https://foo.com' } })

  // 16. CORS OPTIONS 预检请求测试
  await testCase('CORS OPTIONS Preflight Request', '/api', async res => {
    const acao = res.headers.get('access-control-allow-origin')
    const methods = res.headers.get('access-control-allow-methods')
    return (res.status === 200 || res.status === 204) && !!acao && !!methods
  }, { method: 'OPTIONS', headers: { Origin: 'https://foo.com', 'Access-Control-Request-Method': 'GET' } })

  // 17. CORS 规则解析与泛域名算法单元测试
  console.log('--- Testing CORS Origin Pattern Matching ---')
  const corsUnitTests = [
    { env: '*', origin: 'https://any.com', expect: true },
    { env: 'https://a.com,https://b.com', origin: 'https://a.com', expect: true },
    { env: 'https://a.com,https://b.com', origin: 'https://b.com', expect: true },
    { env: 'https://a.com,https://b.com', origin: 'https://c.com', expect: false },
    { env: '*.a.com', origin: 'https://a.com', expect: true },
    { env: '*.a.com', origin: 'https://sub.a.com', expect: true },
    { env: '*.a.com', origin: 'https://music.blog.a.com', expect: true },
    { env: '*.a.com', origin: 'https://not-a.com', expect: false },
    { env: '*.a.com', origin: 'https://fakea.com', expect: false },
    { env: 'https://*.a.com', origin: 'https://sub.a.com', expect: true },
    { env: 'https://*.a.com', origin: 'http://sub.a.com', expect: false }
  ]
  let corsUnitPass = true
  for (const t of corsUnitTests) {
    const matched = isOriginAllowed(t.origin, parseCorsPatterns(t.env))
    if (matched !== t.expect) {
      console.error(`[FAIL] CORS Pattern: env=${t.env}, origin=${t.origin}, expected=${t.expect}, actual=${matched}`)
      corsUnitPass = false
    }
  }
  if (corsUnitPass) {
    console.log('[PASS] CORS Pattern & Wildcard Matching Unit Tests (11 test assertions passed)')
    passCount++
  } else {
    failCount++
  }

  // 18. CORS 动态环境变量集成测试（自定义单源 + 泛域名白名单）
  const originalCors = process.env.CORS_ORIGIN
  try {
    process.env.CORS_ORIGIN = 'https://kafuchino.top, *.example.com'

    // 允许的单源
    await testCase('CORS Env Custom Single Origin Allowed (https://kafuchino.top)', '/health', async res => {
      const acao = res.headers.get('access-control-allow-origin')
      return acao === 'https://kafuchino.top'
    }, { headers: { Origin: 'https://kafuchino.top' } })

    // 允许的泛域名二级域名
    await testCase('CORS Env Wildcard Subdomain Allowed (https://sub.example.com)', '/health', async res => {
      const acao = res.headers.get('access-control-allow-origin')
      return acao === 'https://sub.example.com'
    }, { headers: { Origin: 'https://sub.example.com' } })

    // 未授权的跨域域名（不返回 ACAO 响应头）
    await testCase('CORS Env Disallowed Origin Blocked (https://evil.com)', '/health', async res => {
      const acao = res.headers.get('access-control-allow-origin')
      return acao === null
    }, { headers: { Origin: 'https://evil.com' } })

    // 无 Origin 的非跨域请求正常放行
    await testCase('CORS Non-Origin Request Normal Access', '/health', async res => {
      return res.status === 200
    })
  } finally {
    if (originalCors !== undefined) {
      process.env.CORS_ORIGIN = originalCors
    } else {
      delete process.env.CORS_ORIGIN
    }
  }

  // 19. Cache-Control 响应头校验
  await testCase('Cache-Control Header on Playlist JSON', '/api?server=netease&type=playlist&id=71385702', async res => {
    return res.status === 200 && res.headers.get('cache-control') === 'public, max-age=1800, s-maxage=3600'
  })

  await testCase('Cache-Control Header on Lyric', '/api?server=netease&type=lrc&id=509106775', async res => {
    return res.status === 200 && res.headers.get('cache-control') === 'public, max-age=1800, s-maxage=3600'
  })

  await testCase('Cache-Control Header on Audio URL 302', '/api?server=netease&type=url&id=509106775', async res => {
    return (res.status === 302 || res.status === 301) && res.headers.get('cache-control') === 'public, max-age=300, s-maxage=300'
  })

  await testCase('Cache-Control Header on Pic 302', '/api?server=netease&type=pic&id=509106775', async res => {
    return (res.status === 302 || res.status === 301) && res.headers.get('cache-control') === 'public, max-age=1800, s-maxage=3600'
  })

  // 20. 音质参数 br 传递与直链解析测试
  await testCase('Bitrate Param Propagation in Song List (&br=128)', '/api?server=netease&type=song&id=509106775&br=128', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && json[0].url.includes('&br=128')
  })

  await testCase('Bitrate Param Audio URL 302 (/api?server=netease&type=url&id=509106775&br=128)', '/api?server=netease&type=url&id=509106775&br=128', async res => {
    const loc = res.headers.get('location')
    return (res.status === 302 || res.status === 301) && loc && loc.startsWith('https://')
  })

  // 21. 酷我伪 JSON 安全解析器单元测试与实时搜索测试
  console.log('--- Testing Kuwo Safe Pseudo-JSON Parser ---')
  const kuwoParserCases = [
    { input: "{'HIT':'10','abslist':[{'NAME':'卡农'}]}", check: r => r.HIT === '10' && r.abslist?.[0]?.NAME === '卡农' },
    { input: "{'NAME':'Hello \"World\"','SUB':'It\\'s fine'}", check: r => r.NAME === 'Hello "World"' && r.SUB === "It's fine" },
    { input: '{"HIT":"20","ok":true}', check: r => r.HIT === '20' && r.ok === true },
    { input: "(() => process.env)()", check: r => typeof r === 'object' && Object.keys(r).length === 0 }
  ]
  let kuwoParserPass = true
  for (const tc of kuwoParserCases) {
    const parsed = parseKuwoPseudoJson(tc.input)
    if (!tc.check(parsed)) {
      console.error(`[FAIL] Kuwo Pseudo-JSON Parser failed for input: ${tc.input}, got:`, parsed)
      kuwoParserPass = false
    }
  }
  if (kuwoParserPass) {
    console.log('[PASS] Kuwo Safe Pseudo-JSON Parser Unit Tests (4 test assertions passed)')
    passCount++
  } else {
    failCount++
  }

  await testCase('Kuwo Live Search (/api?server=kuwo&type=search&id=卡农)', '/api?server=kuwo&type=search&id=%E5%8D%A1%E5%86%9C', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length > 0 && Boolean(json[0].title)
  })

  // 22. 无效单曲 ID 空值防御测试（优雅返回空数组，不报未捕获异常）
  await testCase('Invalid Song ID Graceful Empty Array (/api?server=netease&type=song&id=9999999999999)', '/api?server=netease&type=song&id=9999999999999', async res => {
    if (res.status !== 200) return false
    const json = await res.json()
    return Array.isArray(json) && json.length === 0
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
