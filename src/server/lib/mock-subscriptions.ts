const MOCK_SUBSCRIPTIONS: Record<string, string> = {
  "mock://demo-hk": `proxies:
  - name: 香港 IEPL 01
    type: ss
    server: 192.0.2.1
    port: 443
    cipher: aes-256-gcm
    password: demo-hk-01
  - name: 香港 IEPL 02
    type: ss
    server: 192.0.2.2
    port: 443
    cipher: aes-256-gcm
    password: demo-hk-02
  - name: 新加坡 01
    type: trojan
    server: 198.51.100.2
    port: 443
    password: demo-sg-01
    sni: sg.demo.local
`,
  "mock://demo-global": `proxies:
  - name: 日本东京 01
    type: vmess
    server: 203.0.113.3
    port: 443
    uuid: 00000000-0000-4000-8000-000000000001
    alterId: 0
    cipher: auto
    tls: true
    network: ws
  - name: 美国 01
    type: ss
    server: 192.0.2.4
    port: 443
    cipher: aes-256-gcm
    password: demo-us-01
  - name: 台湾 01
    type: ss
    server: 198.51.100.5
    port: 443
    cipher: aes-256-gcm
    password: demo-tw-01
`,
  "mock://rules/apple": `payload:
  - DOMAIN-SUFFIX,apple.com
  - DOMAIN,cdn.example.com
  - IP-CIDR,192.0.2.0/24,no-resolve
`,
  "mock://rules/invalid": "proxies: []\n",
};

export function getMockSubscription(url: string): string | null {
  return MOCK_SUBSCRIPTIONS[url] ?? null;
}
