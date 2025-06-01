# koishi-plugin-server-status

Koishi 插件，用于查询服务器状态信息，支持图表显示和自定义背景。

## 功能

- 通过指令 `查看状态` 查询服务器的负载信息
- 显示 CPU 使用率、内存使用率、系统运行时间等信息
- 监控并显示网络带宽使用情况（下载/上传速度）
- 美观的图表展示历史数据趋势（CPU、内存、网络带宽）
- 支持自定义背景图片
- 支持同时使用带斜杠和不带斜杠的命令
- 支持自定义机器人名称

## 安装

```sh
npm install koishi-plugin-server-status
```

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| commandName | string | '查看状态' | 命令名称 |
| authority | number | 1 | 使用权限等级 |
| imageMode | boolean | true | 是否使用图片模式 |
| showText | boolean | false | 图片模式下是否同时显示文本 |
| cooldown | number | 60 | 全局冷却时间（秒） |
| usePrefix | boolean | false | 是否使用斜杠前缀 |
| botName | string | 'QQ机器人' | 自定义机器人名称 |
| backgroundImage | string | '' | 自定义背景图片URL |
| historyLength | number | 10 | 历史数据保存数量 |
| collectInterval | number | 60 | 历史数据收集间隔（秒） |
| renderTimeout | number | 30 | 渲染超时时间（秒） |
| useLocalChartJs | boolean | false | 是否使用本地Chart.js文件 |
| mainNetworkInterface | string | '' | 主要网络接口名称，留空则自动选择最活跃的接口 |

## 使用方法

1. 在 Koishi 应用中启用该插件
2. 根据需要调整配置项（如命令名称、权限、自定义背景等）
3. 在聊天中发送 `查看状态` 指令（或自定义的命令）即可查看服务器状态

## 更新日志

### v1.1.0
- 添加网络带宽监控功能
- 添加带宽历史图表
- 支持自定义背景图片
- 优化图表显示效果
- 修复已知问题

### v1.0.1
- 初始版本发布 