const { Context, Schema, segment } = require('koishi')
const os = require('os')
const osUtils = require('os-utils')
const path = require('path')
const fs = require('fs')
const si = require('systeminformation')

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

// 格式化带宽，根据大小自适应单位
function formatBandwidth(bytesPerSec) {
  if (bytesPerSec < 1024) {
    return bytesPerSec.toFixed(2) + ' B/s'
  } else if (bytesPerSec < 1024 * 1024) {
    return (bytesPerSec / 1024).toFixed(2) + ' KB/s'
  } else if (bytesPerSec < 1024 * 1024 * 1024) {
    return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s'
  } else {
    return (bytesPerSec / (1024 * 1024 * 1024)).toFixed(2) + ' GB/s'
  }
}

// 插件名称
exports.name = 'server-status'

// 插件配置
exports.Config = Schema.object({
  commandName: Schema.string().default('查看状态').description('命令名称'),
  authority: Schema.number().default(1).description('使用权限等级(默认: 1)'),
  imageMode: Schema.boolean().default(true).description('是否使用图片模式(默认: 启用)'),
  showText: Schema.boolean().default(false).description('图片模式下是否同时显示文本(默认: 不显示)'),
  cooldown: Schema.number().default(60).description('全局冷却时间，单位为秒(默认: 60)'),
  usePrefix: Schema.boolean().default(false).description('是否使用斜杠前缀(默认: 不使用)'),
  botName: Schema.string().default('QQ机器人').description('自定义机器人名称(默认: QQ机器人)'),
  historyLength: Schema.number().default(10).description('历史数据保存数量(默认: 10)'),
  collectInterval: Schema.number().default(60).description('历史数据收集间隔，单位为秒(默认: 60)'),
  renderTimeout: Schema.number().default(30).description('渲染超时时间，单位为秒(默认: 30)'),
  useLocalChartJs: Schema.boolean().default(false).description('是否使用本地 Chart.js 文件(默认: 不使用)'),
  mainNetworkInterface: Schema.string().description('主要网络接口名称，留空则自动选择最活跃的接口'),
  backgroundImage: Schema.string().description('自定义背景图片URL，留空则使用默认背景')
})

// 声明插件依赖
exports.using = ['puppeteer']

// 插件函数
exports.apply = (ctx, config) => {
  // 使用配置中的命令名称，默认为"查看状态"
  let commandName = config.commandName || '查看状态'
  
  // 如果设置使用斜杠前缀，则添加斜杠
  if (config.usePrefix && !commandName.startsWith('/')) {
    commandName = '/' + commandName
  }
  
  // 全局冷却时间
  const cooldownTime = (config.cooldown || 60) * 1000
  let lastCommandTime = 0
  
  // 创建缓存模板路径
  const templatePath = path.resolve(__dirname, './template.html')
  if (!fs.existsSync(templatePath)) {
    ctx.logger.error(`找不到模板文件: ${templatePath}`)
  }
  
  // 如果启用本地 Chart.js，则检查或下载 Chart.js 文件
  const chartJsPath = path.resolve(__dirname, './chart.min.js')
  if (config.useLocalChartJs && !fs.existsSync(chartJsPath)) {
    ctx.logger.info('正在下载 Chart.js 文件...')
    // 使用 https 模块下载 Chart.js
    const https = require('https')
    const file = fs.createWriteStream(chartJsPath)
    https.get('https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js', (response) => {
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        ctx.logger.info('Chart.js 文件下载完成')
      })
    }).on('error', (err) => {
      fs.unlink(chartJsPath, () => {})
      ctx.logger.error('下载 Chart.js 文件失败:', err.message)
    })
  }
  
  // 如果使用本地 Chart.js，修改模板文件中的 Chart.js 引用
  function prepareTemplate(page) {
    if (config.useLocalChartJs && fs.existsSync(chartJsPath)) {
      return page.evaluateOnNewDocument(() => {
        // 防止外部 Chart.js 加载
        window.preventExternalChartJs = true
      }).then(() => {
        // 注入本地 Chart.js
        return page.addScriptTag({
          path: chartJsPath
        })
      })
    }
    return Promise.resolve()
  }
  
  // 网络数据统计变量
  let lastNetworkStats = null
  let mainNetworkInterface = config.mainNetworkInterface || ''
  let networkInterfaces = []
  
  // 获取主要网络接口
  async function updateNetworkInterfaces() {
    try {
      const interfaces = await si.networkInterfaces()
      networkInterfaces = interfaces || []
      
      // 如果没有指定接口，则选择第一个非内部的接口
      if (!mainNetworkInterface && networkInterfaces.length > 0) {
        // 优先选择非内部接口
        const externalInterface = networkInterfaces.find(iface => 
          !iface.internal && iface.ifaceName && iface.type && iface.type.toLowerCase().includes('ethernet')
        )
        
        if (externalInterface) {
          mainNetworkInterface = externalInterface.ifaceName
          ctx.logger.info(`自动选择网络接口: ${mainNetworkInterface}`)
        } else {
          mainNetworkInterface = networkInterfaces[0].ifaceName
          ctx.logger.info(`没有找到外部网络接口，使用第一个接口: ${mainNetworkInterface}`)
        }
      }
    } catch (err) {
      ctx.logger.error('获取网络接口失败:', err)
    }
  }
  
  // 初始化网络接口
  updateNetworkInterfaces()
  
  // 历史数据存储
  const historyData = {
    cpu: {
      labels: [],
      values: []
    },
    memory: {
      labels: [],
      values: []
    },
    network: {
      labels: [],
      download: [],
      upload: []
    }
  }
  
  // 历史数据收集函数
  async function collectHistoryData() {
    try {
      // 获取CPU使用率
      const cpuUsage = await new Promise((resolve) => {
        osUtils.cpuUsage((value) => {
          resolve(value)
        })
      })
      
      // 获取内存使用率
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const memUsage = (totalMem - freeMem) / totalMem
      
      // 获取网络统计
      let downloadSpeed = 0
      let uploadSpeed = 0
      
      try {
        const networkStats = await si.networkStats(mainNetworkInterface)
        
        if (networkStats && networkStats.length > 0) {
          const stats = networkStats[0]
          
          if (lastNetworkStats) {
            // 计算间隔时间（秒）
            const timeDiff = (stats.ms - lastNetworkStats.ms) / 1000
            if (timeDiff > 0) {
              // 计算字节/秒
              downloadSpeed = (stats.rx_bytes - lastNetworkStats.rx_bytes) / timeDiff
              uploadSpeed = (stats.tx_bytes - lastNetworkStats.tx_bytes) / timeDiff
              
              // 避免负值（可能由于计数器重置或系统重启）
              if (downloadSpeed < 0) downloadSpeed = 0
              if (uploadSpeed < 0) uploadSpeed = 0
            }
          }
          
          lastNetworkStats = stats
        }
      } catch (err) {
        ctx.logger.error('获取网络统计失败:', err)
      }
      
      // 获取当前时间
      const now = new Date()
      const timeLabel = now.getHours().toString().padStart(2, '0') + ':' + 
                        now.getMinutes().toString().padStart(2, '0')
      
      // 添加到历史数据
      historyData.cpu.labels.push(timeLabel)
      historyData.cpu.values.push(parseFloat((cpuUsage * 100).toFixed(2)))
      
      historyData.memory.labels.push(timeLabel)
      historyData.memory.values.push(parseFloat((memUsage * 100).toFixed(2)))
      
      historyData.network.labels.push(timeLabel)
      historyData.network.download.push(downloadSpeed)
      historyData.network.upload.push(uploadSpeed)
      
      // 限制历史数据长度
      const historyLength = config.historyLength || 10
      if (historyData.cpu.labels.length > historyLength) {
        historyData.cpu.labels.shift()
        historyData.cpu.values.shift()
      }
      if (historyData.memory.labels.length > historyLength) {
        historyData.memory.labels.shift()
        historyData.memory.values.shift()
      }
      if (historyData.network.labels.length > historyLength) {
        historyData.network.labels.shift()
        historyData.network.download.shift()
        historyData.network.upload.shift()
      }
      
      ctx.logger.debug(`收集历史数据: CPU ${(cpuUsage * 100).toFixed(2)}%, 内存 ${(memUsage * 100).toFixed(2)}%, 下载 ${formatBandwidth(downloadSpeed)}, 上传 ${formatBandwidth(uploadSpeed)}`)
    } catch (err) {
      ctx.logger.error('收集历史数据失败:', err)
    }
  }
  
  // 定时收集历史数据
  const collectInterval = (config.collectInterval || 60) * 1000
  const timer = setInterval(collectHistoryData, collectInterval)
  
  // 初始收集一次数据
  collectHistoryData()
  
  // 每小时更新一次网络接口列表
  const interfaceUpdateTimer = setInterval(updateNetworkInterfaces, 3600 * 1000)
  
  // 插件卸载时清除定时器
  ctx.on('dispose', () => {
    clearInterval(timer)
    clearInterval(interfaceUpdateTimer)
  })
  
  // 注册命令 - 支持带斜杠和不带斜杠两种形式
  const cmdOptions = { authority: config.authority || 1 }
  
  // 不带斜杠的命令
  const plainCmd = commandName.replace(/^\//, '')
  
  // 带斜杠的命令
  const slashCmd = commandName.startsWith('/') ? commandName : '/' + commandName
  
  // 注册不带斜杠的命令
  const cmd = ctx.command(plainCmd, '查询服务器状态信息', cmdOptions)
  
  // 如果命令不同，则添加别名
  if (plainCmd !== slashCmd.substring(1)) {
    cmd.alias(slashCmd.substring(1))
  }
  
  // 添加带斜杠的别名
  cmd.alias(slashCmd)
  
  // 添加命令处理逻辑
  cmd.action(async ({ session }) => {
    // 检查全局冷却时间
    const now = Date.now()
    if (now - lastCommandTime < cooldownTime) {
      const remainSeconds = Math.ceil((cooldownTime - (now - lastCommandTime)) / 1000)
      return `命令冷却中，请在 ${remainSeconds} 秒后再试`
    }
    
    try {
      // 更新最后命令执行时间
      lastCommandTime = now
      
      // 缓存CPU和内存信息采集开始时间
      const startTime = process.hrtime()
      
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
      
      // 优化CPU信息获取，只获取第一个核心信息即可
      const cpuInfo = os.cpus()
      const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : '未知'
      const cpuCores = cpuInfo.length
      
      // 获取系统负载
      const loadAvg = os.loadavg()
      
      // 获取实时网络速度
      let downloadSpeed = 0
      let uploadSpeed = 0
      
      try {
        const networkStats = await si.networkStats(mainNetworkInterface)
        if (networkStats && networkStats.length > 0) {
          // 使用最新收集的网络速度（已经在历史数据收集中计算过）
          if (historyData.network.download.length > 0) {
            downloadSpeed = historyData.network.download[historyData.network.download.length - 1]
          }
          if (historyData.network.upload.length > 0) {
            uploadSpeed = historyData.network.upload[historyData.network.upload.length - 1]
          }
        }
      } catch (e) {
        ctx.logger.error('获取网络速度失败:', e)
      }

      // 计算信息采集耗时
      const elapsedTime = process.hrtime(startTime)
      const infoCollectionTime = (elapsedTime[0] * 1000 + elapsedTime[1] / 1000000).toFixed(2)
      ctx.logger.debug(`系统信息收集耗时: ${infoCollectionTime}ms`)

      // 准备状态数据
      const statusData = {
        hostname,
        platform,
        uptime: formatUptime(uptime),
        cpuModel,
        cpuCores,
        cpuUsage: formatPercent(cpuUsage),
        usedMemory: formatMemory(usedMem),
        totalMemory: formatMemory(totalMem),
        memUsagePercent: formatPercent(memUsage),
        loadAvg: `${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)} (1, 5, 15分钟)`,
        username: config.botName || 'QQ机器人',
        copyright: 'ZHUQIY保留所有权利',
        networkInterface: mainNetworkInterface || '未知',
        downloadSpeed: formatBandwidth(downloadSpeed),
        uploadSpeed: formatBandwidth(uploadSpeed),
        historyData: JSON.parse(JSON.stringify(historyData)), // 深拷贝历史数据
        backgroundImage: config.backgroundImage || '' // 添加背景图片URL
      }

      // 生成文本状态报告
      const textStatusReport = [
        '服务器状态报告',
        `主机名称: ${hostname}`,
        `操作系统: ${platform}`,
        `运行时间: ${formatUptime(uptime)}`,
        `CPU型号: ${cpuModel}`,
        `CPU核心: ${cpuCores}核`,
        `CPU使用率: ${formatPercent(cpuUsage)}`,
        `内存使用: ${formatMemory(usedMem)} / ${formatMemory(totalMem)} (${formatPercent(memUsage)})`,
        `系统负载: ${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)} (1, 5, 15分钟)`,
        `网络接口: ${mainNetworkInterface || '未知'}`,
        `下载速度: ${formatBandwidth(downloadSpeed)}`,
        `上传速度: ${formatBandwidth(uploadSpeed)}`,
        `© ZHUQIY保留所有权利`
      ].join('\n')

      // 如果禁用了图片模式或puppeteer服务不可用，就返回文本
      if (!config.imageMode || !ctx.puppeteer) {
        return textStatusReport
      }

      // 使用puppeteer渲染图片
      try {
        const renderStartTime = process.hrtime()
        
        // 创建puppeteer页面，并设置超时
        const page = await ctx.puppeteer.page({
          timeout: (config.renderTimeout || 30) * 1000, // 使用配置的超时时间，默认30秒
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security']
        })
        
        // 设置视口大小 - 增加高度以适应图表
        await page.setViewport({ width: 900, height: 1100 })
        
        // 准备模板（可能包括注入本地 Chart.js）
        await prepareTemplate(page)
        
        // 打开模板 - 增加超时和错误处理
        try {
          await page.goto(`file://${templatePath}`, { 
            waitUntil: 'networkidle0',
            timeout: (config.renderTimeout || 30) * 1000 // 使用配置的超时时间
          })
        } catch (navError) {
          ctx.logger.warn('模板导航超时，尝试继续渲染:', navError.message)
          // 即使导航超时，我们也尝试继续渲染
        }
        
        // 添加额外等待以确保页面完全加载
        await page.waitForFunction(() => document && document.readyState === 'complete', { 
          timeout: 5000 
        }).catch(e => ctx.logger.warn('等待页面完成加载超时:', e.message))
        
        // 注入数据并执行脚本
        await page.evaluate(`action(${JSON.stringify(statusData)})`)
        
        // 使用setTimeout替代waitForTimeout，等待渲染完成，增加等待时间
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)))
        
        // 等待图表渲染完成
        await page.waitForFunction(() => {
          const cpuChart = document.getElementById('cpu-chart');
          const memChart = document.getElementById('memory-chart');
          const networkChart = document.getElementById('network-chart');
          return cpuChart && memChart && networkChart && 
                 (cpuChart.__chart__ || window.Chart && window.Chart.instances && window.Chart.instances.length >= 3);
        }, { timeout: 5000 }).catch(e => ctx.logger.warn('等待图表渲染超时:', e.message))
        
        // 获取元素
        const element = await page.$('#background-page')
        
        if (!element) {
          throw new Error('无法找到背景页面元素')
        }
        
        // 截图
        const screenshot = await element.screenshot({
          encoding: 'binary',
          type: 'png',
          omitBackground: true
        })
        
        // 立即关闭页面释放资源
        await page.close()
        
        // 计算渲染耗时
        const renderElapsedTime = process.hrtime(renderStartTime)
        const renderTime = (renderElapsedTime[0] * 1000 + renderElapsedTime[1] / 1000000).toFixed(2)
        ctx.logger.debug(`图片渲染耗时: ${renderTime}ms`)
        
        // 返回结果
        if (config.showText) {
          return [
            segment.image(screenshot, 'image/png'),
            textStatusReport
          ]
        } else {
          return segment.image(screenshot, 'image/png')
        }
      } catch (e) {
        ctx.logger.error('状态图片渲染失败:', e)
        
        // 在错误消息中添加更多信息
        let errorMessage = `图片渲染失败: ${e.message}`
        if (e.stack) {
          ctx.logger.debug('渲染错误堆栈:', e.stack)
        }
        
        // 显示更友好的错误消息并返回文本状态
        return `${errorMessage}\n\n改用文本状态信息：\n${textStatusReport}`
      }
    } catch (err) {
      ctx.logger.error('获取服务器状态失败:', err)
      return '获取服务器状态信息失败: ' + err.message
    }
  })
} 