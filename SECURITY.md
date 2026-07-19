# 安全策略

## 支持范围

项目尚未建立稳定版本和长期支持分支。安全修复以默认分支的最新代码为准。

## 报告漏洞

请优先使用 GitHub 仓库的 **Security -> Report a vulnerability** 私下报告。若仓库尚未启用 Private Vulnerability Reporting，请通过维护者 GitHub 主页提供的私密联系方式联系，并仅发送建立安全沟通所需的最少信息。

报告中建议包含受影响版本或 commit、复现条件、影响范围和建议修复方向。请先隐去订阅 URL、controller secret、设备 token、数据库内容和个人基础设施信息。

不要在公开 issue、discussion 或 PR 中披露尚未修复的漏洞细节。收到报告后，维护者会先确认影响和处理方式，再协调披露时间；当前不承诺固定响应时限。

## 部署边界

本项目是本地或可信网络中的管理工具，不是经过加固的公网控制面：

- 管理 API 没有内置登录和权限控制。
- 新数据库默认监听 `127.0.0.1`，CORS 默认关闭。
- 设备订阅 URL 使用 bearer token，持有 URL 即可读取对应配置。
- SQLite、生成的 YAML 和配置包可能明文包含订阅 URL、controller secret 和设备 token。

不要把服务端口直接映射到公网。远程使用时，应放在 VPN、SSH tunnel 或带身份认证和 TLS 的反向代理之后，并限制源地址。反向代理与 API 同源时无需开启 CORS；只有确实需要跨域浏览器访问时，才设置精确的 `NEKOCUBE_CORS_ORIGINS`，不要使用 `*`。

修改监听地址、controller 地址或 `allow-lan` 前，应同时检查主机防火墙和上游网络边界。已有数据库不会因为代码默认值变化而自动收紧，请在升级后手动复核应用设置。

## 敏感数据处理

- 将设备 token、订阅 URL 和 controller secret 视为凭证；泄露后立即轮换。
- 限制 `data/`、`.dev/`、生成配置和备份文件的文件系统权限。
- 分享日志、截图和配置预览前先脱敏。
- 不要把生产数据库或配置包用作公开 issue 的复现材料。
- 备份应加密，并采用与其他凭证相同的访问控制和保留策略。

## 外部连接

服务可能访问订阅源、rule provider、Mihomo controller、GeoIP 数据库下载地址、在线 GeoIP 查询接口和 ClickHouse。

GeoIP 数据库自动更新默认开启；本地查询无结果时也可能使用在线查询，目标 IP 会发送给所配置的服务。要求离线运行时，应至少设置：

```bash
export GEOIP_MMDB_AUTO_UPDATE=0
export GEOIP_LOOKUP_PROVIDER=local
```

同时应检查订阅源、rule provider、controller 和 ClickHouse 配置，确认它们没有指向外部地址。
