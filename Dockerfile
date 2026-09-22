FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:$PATH

# ============================================================
# SYSTEM DEPENDENCIES
# ============================================================

RUN apt-get update && apt-get install -y \
    openjdk-17-jdk \
    wget \
    unzip \
    zip \
    git \
    curl \
    ca-certificates \
    bash \
    grep \
    sed \
    awk \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# ANDROID COMMAND LINE TOOLS
# ============================================================

RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools

RUN wget -q \
    https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
    -O /tmp/cmdline-tools.zip \
    && unzip -q /tmp/cmdline-tools.zip \
       -d ${ANDROID_SDK_ROOT}/cmdline-tools \
    && mv \
       ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools \
       ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip

# ============================================================
# ACCEPT ANDROID LICENSES
# ============================================================

RUN yes | sdkmanager --licenses >/dev/null || true

# ============================================================
# FIND AND INSTALL ANDROID 17 / API 37
# ============================================================
# We do NOT hardcode a package name that may only exist
# on a preview/beta SDK channel.
#
# We inspect all SDK channels and automatically select
# the available API 37 platform and Build Tools 37.
# ============================================================

RUN set -eux; \
    sdkmanager --list --channel=3 > /tmp/sdk-list; \
    echo "===== API 37 PACKAGES FOUND ====="; \
    grep -E 'platforms;android-37|build-tools;37' /tmp/sdk-list || true; \
    echo "================================="; \
    PLATFORM="$(grep -oE 'platforms;android-37(\.[0-9]+)?' /tmp/sdk-list | sort -Vu | tail -1)"; \
    BUILD_TOOLS="$(grep -oE 'build-tools;37\.[0-9]+\.[0-9]+' /tmp/sdk-list | sort -Vu | tail -1)"; \
    echo "Selected Android Platform: ${PLATFORM}"; \
    echo "Selected Build Tools:      ${BUILD_TOOLS}"; \
    test -n "${PLATFORM}"; \
    test -n "${BUILD_TOOLS}"; \
    yes | sdkmanager --channel=3 \
        "platform-tools" \
        "${PLATFORM}" \
        "${BUILD_TOOLS}"

# ============================================================
# BUILDER DIRECTORY
# ============================================================

WORKDIR /builder

# ============================================================
# CLONE WEBVIEW APK TEMPLATE
# ============================================================

RUN git clone --depth 1 \
    https://github.com/xchacha20-poly1305/webview-apk-template.git \
    /builder/template

# ============================================================
# NODE API
# ============================================================

COPY package.json ./

RUN npm install --omit=dev

COPY server.js ./

# ============================================================
# DIRECTORIES
# ============================================================

RUN mkdir -p \
    /builder/jobs \
    /builder/builds

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# ============================================================
# START API
# ============================================================

CMD ["node", "server.js"]
