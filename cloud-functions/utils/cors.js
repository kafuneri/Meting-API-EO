/**
 * CORS 跨域白名单解析与校验模块
 * 支持：
 * 1. 默认 '*'（允许所有源跨域）
 * 2. 单个源：如 https://a.com
 * 3. 多个源（逗号分隔）：如 https://a.com,https://b.com
 * 4. 泛域名匹配：如 *.a.com 或 https://*.a.com（自动匹配主域名及其所有子域名）
 * 5. 端口适配：如 http://localhost:3000, *.a.com:8080
 */

/**
 * 解析 CORS 环境变量为匹配规则列表
 * @param {string} [corsEnv] 
 * @returns {string|string[]} '*' 或规则数组
 */
export function parseCorsPatterns (corsEnv) {
  if (!corsEnv || typeof corsEnv !== 'string' || corsEnv.trim() === '*' || corsEnv.trim() === '') {
    return '*'
  }
  return corsEnv
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
}

/**
 * 判断指定请求 Origin 是否命中允许白名单规则
 * @param {string|undefined} origin 请求头中的 Origin
 * @param {string|string[]} patterns parseCorsPatterns 返回的规则
 * @returns {boolean} 是否允许跨域
 */
export function isOriginAllowed (origin, patterns) {
  // 无 Origin 头（如 curl、服务端脚本、本地同源调用）默认放行
  if (!origin) return true

  // 默认通配符 '*' 允许所有源
  if (patterns === '*' || (Array.isArray(patterns) && patterns.includes('*'))) {
    return true
  }

  // 规范化待检测的 origin
  const cleanOrigin = origin.replace(/\/+$/, '')
  let originUrl
  try {
    originUrl = new URL(cleanOrigin)
  } catch {
    return false
  }

  const originHostname = originUrl.hostname.toLowerCase()
  const originProtocol = originUrl.protocol.toLowerCase()
  const originPort = originUrl.port

  for (const pattern of patterns) {
    const cleanPattern = pattern.replace(/\/+$/, '').toLowerCase()

    // 1. 完全精确匹配（如 https://a.com 或 http://localhost:3000）
    if (cleanPattern === cleanOrigin.toLowerCase()) {
      return true
    }

    // 2. 泛域名与通配符规则匹配（包含 '*'）
    if (cleanPattern.includes('*')) {
      let targetProto = null
      let rawHostPattern = cleanPattern

      if (cleanPattern.startsWith('https://')) {
        targetProto = 'https:'
        rawHostPattern = cleanPattern.slice(8)
      } else if (cleanPattern.startsWith('http://')) {
        targetProto = 'http:'
        rawHostPattern = cleanPattern.slice(7)
      } else if (cleanPattern.startsWith('//')) {
        rawHostPattern = cleanPattern.slice(2)
      }

      // 协议不匹配则跳过
      if (targetProto && originProtocol !== targetProto) {
        continue
      }

      // 端口匹配检查
      let targetPort = null
      if (rawHostPattern.includes(':')) {
        const parts = rawHostPattern.split(':')
        rawHostPattern = parts[0]
        targetPort = parts[1]
      }
      if (targetPort && originPort !== targetPort) {
        continue
      }

      // 泛域名 *.example.com 匹配（覆盖主域名 example.com 及其各级子域名 *.example.com）
      if (rawHostPattern.startsWith('*.')) {
        const baseDomain = rawHostPattern.slice(2)
        if (originHostname === baseDomain || originHostname.endsWith('.' + baseDomain)) {
          return true
        }
      } else {
        // 通用通配符转为正则表达式
        const regexStr = '^' + rawHostPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
        const regex = new RegExp(regexStr, 'i')
        if (regex.test(originHostname)) {
          return true
        }
      }
    } else {
      // 3. 用户未携带协议前缀时的纯域名匹配（如 a.com 或 blog.a.com）
      if (!cleanPattern.includes('://')) {
        if (originHostname === cleanPattern) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * 创建 Express CORS 中间件的 origin 校验回调函数
 * @param {Function} [getEnv] 可选的环境变量获取钩子（方便动态读取 process.env）
 * @returns {Function} cors origin 回调 (origin, callback) => void
 */
export function createCorsOriginChecker (getEnv = () => process.env.CORS_ORIGIN || process.env.ALLOW_ORIGIN || process.env.METING_CORS_ORIGIN || '*') {
  return function (origin, callback) {
    const corsEnv = getEnv()
    const patterns = parseCorsPatterns(corsEnv)
    if (isOriginAllowed(origin, patterns)) {
      callback(null, true)
    } else {
      // 不在白名单中的源，不返回 Access-Control-Allow-Origin，由浏览器安全机制进行阻断
      callback(null, false)
    }
  }
}
