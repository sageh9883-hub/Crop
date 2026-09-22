FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/build-tools/37.0.0:$PATH

RUN apt-get update && apt-get install -y \
    openjdk-17-jdk \
    wget \
    unzip \
    zip \
    git \
    curl \
    ca-certificates \
    bash \
    && rm -rf /var/lib/apt/lists/*

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

RUN yes | sdkmanager --licenses >/dev/null || true

RUN sdkmanager \
    "platform-tools" \
    "platforms;android-37" \
    "build-tools;37.0.0"

WORKDIR /builder

RUN git clone --depth 1 \
    https://github.com/xchacha20-poly1305/webview-apk-template.git \
    /builder/template

COPY package.json ./

RUN npm install --omit=dev

COPY server.js ./

RUN mkdir -p /builder/jobs /builder/builds

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.js"]
