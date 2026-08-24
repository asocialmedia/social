{ pkgs, ... }:

let
  bun-1_4 = pkgs.bun.overrideAttrs (oldAttrs: rec {
    pname = "bun";
    version = "1.4.0";
    src = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64.zip";
      sha256 = "0lp45zljagwcv1l2jv7mi3a1j6hsrsr838m0mikvbj1sp1gzn0rd";
    };
  });
in

{
  packages = with pkgs; [ git curl openssl prisma-engines ];

  languages.javascript = {
    enable = true;
    bun.enable = true;
    bun.package = bun-1_4;
    bun.install.enable = true;
    lsp.enable = true;
  };
  languages.typescript.enable = true;

  env = {
    PRISMA_SCHEMA_ENGINE_BINARY = "${pkgs.prisma-engines}/bin/schema-engine";
    PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
    SSL_CERT_FILE = "/etc/ssl/certs/ca-certificates.crt";
    SSL_CERT_DIR = "/etc/ssl/certs";
  };

  scripts = {
    db-gen.exec = "bun run db:gen";
    db-push.exec = "bun run db:push";
    db-studio.exec = "bun run --filter=@asm/db studio";
    dev.exec = "bun run dev";
    check.exec = "bun run check";
    check-types.exec = "bun run check-types";
  };

  enterShell = ''
    if [ -x "${pkgs.prisma-engines}/bin/prisma-fmt" ]; then
      export PRISMA_FMT_BINARY="${pkgs.prisma-engines}/bin/prisma-fmt"
    fi

    # portless: let Node/curl trust the local CA (NixOS has no update-ca-certificates,
    # so `portless trust` can't touch the system store - browsers need the CA added
    # via security.pki.certificateFiles in configuration.nix instead)
    if [ -f "$HOME/.portless/ca.pem" ]; then
      export NODE_EXTRA_CA_CERTS="$HOME/.portless/ca.pem"
    fi
  '';

  dotenv.disableHint = true;
}
