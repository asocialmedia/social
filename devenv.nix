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

  desktop-libs = with pkgs; [
    stdenv.cc.cc.lib
    dbus
    glib
    nspr
    nss
    at-spi2-core
    cups
    cairo
    pango
    gtk3
    libx11
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    libxcb
    mesa
    libgbm
    expat
    libxkbcommon
    udev
    alsa-lib
    libpulseaudio
    zlib
    libpng
    libdrm
    libxi
    libxkbfile
    util-linux
    libbsd
    xorg.libSM
    xorg.libICE
    xorg.xcbutilcursor
    xorg.xcbutilwm
    xorg.xcbutilimage
    xorg.xcbutilkeysyms
    xorg.xcbutilrenderutil
    xorg.xcbutil
  ];
in

{
  packages = with pkgs; [
    git
    curl
    openssl
    prisma-engines
    stdenv.cc.cc.lib
    watchman
    android-tools
    jdk17
    dotslash
  ];

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
    JAVA_HOME = "${pkgs.jdk17.home}";
  };

  scripts = {
    db-gen.exec = "bun run db:gen";
    db-push.exec = "bun run db:push";
    db-studio.exec = "bun run --filter=@asm/db studio";
    dev.exec = "bun run dev";
    check.exec = "bun run check";
    check-types.exec = "bun run check-types";
    mob.exec = "bun run mob";
    mob-emu.exec = "bun run mob:emu";
  };

  enterShell = ''
    # Native Node addons dlopen libstdc++ by soname, and React Native DevTools
    # and Android Emulator (qemu) require Desktop/Audio/Graphics runtime libraries on NixOS.
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath desktop-libs}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export QT_QPA_PLATFORM="xcb"

    if [ -x "${pkgs.prisma-engines}/bin/prisma-fmt" ]; then
      export PRISMA_FMT_BINARY="${pkgs.prisma-engines}/bin/prisma-fmt"
    fi

    if [ -z "$ANDROID_HOME" ] && [ -d "$HOME/Android/Sdk" ]; then
      export ANDROID_HOME="$HOME/Android/Sdk"
      export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
    fi
  '';

  dotenv.disableHint = true;
}
