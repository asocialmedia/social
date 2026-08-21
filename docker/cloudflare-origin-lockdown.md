# Cloudflare Origin Lockdown

The origin server answers on 80/443 for any Host header it knows. That means anyone who discovers the origin IP can bypass Cloudflare entirely (WAF, rate limiting, bot fighting) by talking to the IP directly with a forged `Host` header.

Two layers close this. Apply both.

## Layer 1: app-level rejection (shipped, off by default)

`apps/web/src/proxy.ts` rejects requests that never traversed Cloudflare when the `ENFORCE_CLOUDFLARE` env var is set:

```
ENFORCE_CLOUDFLARE=1
```

Add this to the ASM application environment in Dokploy and redeploy. Every legitimate request already arrives through Cloudflare (which always sets `cf-connecting-ip`), so flipping this on is safe for users; container health checks and local development are unaffected (loopback is exempt).

## Layer 2: firewall (recommended)

Restrict inbound 80/443 on the host to Cloudflare's published IP ranges so bypass traffic dies at the socket instead of at the app.

Get the current ranges:

```sh
curl -4s https://www.cloudflare.com/ips-v4
curl -6s https://www.cloudflare.com/ips-v6
```

Then apply with nftables (NixOS users: put the equivalent rules in `networking.firewall.extraInputRules` or use the nftables module):

```sh
# allow established, drop direct 80/443 except CF
for ip in $(curl -4s https://www.cloudflare.com/ips-v4); do
  nft add rule inet filter input tcp dport {80,443} ip saddr "$ip" accept
done
nft add rule inet filter input tcp dport {80,443} drop
```

On NixOS, declaratively:

```nix
networking.firewall.extraInputRules = ''
  ip saddr { <cf-v4-ranges-comma-separated> } tcp dport { 80, 443 } accept
  ip6 saddr { <cf-v6-ranges-comma-separated> } tcp dport { 80, 443 } accept
  tcp dport { 80, 443 } drop
'';
```

## Verify

After enabling both layers:

```sh
# must fail (403 / timeout)
curl -sk --resolve asocialmedia.cc:443:<ORIGIN_IP> https://asocialmedia.cc/api/health

# must succeed through Cloudflare
curl -s https://asocialmedia.cc/api/health
```

## Also rotate

- The Dokploy API key that was shared during the audit (full server control).
- Consider moving `dash.przknv.cc` behind an VPN allowlist or at minimum enable Dokploy's built-in 2FA.
