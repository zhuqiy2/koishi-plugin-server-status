// 直接测试服务器状态功能
const os = require('os')
const osUtils = require('os-utils')

// 格式化时间显示
function formatUptime(uptime) {
  const days = Math.floor(uptime / (3600 * 24))
  const hours = Math.floor((uptime % (3600 * 24)) / 3600)
  const minutes = Math.floor((uptime % 3600) / 60)
  const seconds = Math.floor(uptime % 60)
  
  let result = ''
  if (days > 0) result += `${days}天`
  if (hours > 0) result += `${hours}小时`
  if (minutes > 0) result += `${minutes}分钟`
  if (seconds > 0) result += `${seconds}秒`
  
  return result || '0秒'
}

// 格式化内存显示，转换为GB并保留两位小数
function formatMemory(bytes) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

// 格式化百分比
function formatPercent(num) {
  return (num * 100).toFixed(2) + '%'
}

// 测试获取服务器状态信息的功能
async function testServerStatus() {
  // 获取CPU使用率（异步）
  const cpuUsage = await new Promise((resolve) => {
    osUtils.cpuUsage((value) => {
      resolve(value)
    })
  })

  // 获取内存信息
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const memUsage = usedMem / totalMem

  // 获取系统运行时间
  const uptime = os.uptime()

  // 获取系统信息
  const platform = os.platform()
  const hostname = os.hostname()
  const cpuModel = os.cpus()[0].model
  const cpuCores = os.cpus().length

  // 获取系统负载
  const loadAvg = os.loadavg()

  // 生成状态报告
  const statusReport = [
    '📊 服务器状态报告',
    `🖥️ 主机名称: ${hostname}`,
    `💻 操作系统: ${platform}`,
    `🔄 运行时间: ${formatUptime(uptime)}`,
    `⚙️ CPU型号: ${cpuModel}`,
    `🧮 CPU核心: ${cpuCores}核`,
    `📈 CPU使用率: ${formatPercent(cpuUsage)}`,
    `🧠 内存使用: ${formatMemory(usedMem)} / ${formatMemory(totalMem)} (${formatPercent(memUsage)})`,
    `⚖️ 系统负载: ${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)} (1, 5, 15分钟)`
  ].join('\n')

  console.log('服务器状态信息测试结果:')
  console.log(statusReport)
}

// 执行测试
testServerStatus() 