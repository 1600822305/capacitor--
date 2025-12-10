# AetherLink Capacitor Fork - Cherry-Pick 记录

基于 Capacitor 7.4.4，从 8.0.0 选择性合并的提交记录。

## 已合并的提交 (2024-12-10)

### Bug 修复

| 提交哈希 | 描述 | 状态 |
|----------|------|------|
| `e6f50b8c` | fix(ios): move PrivacyInfo.xcprivacy to resource_bundles | ✅ 已合并 |
| `2dc20ee8` | fix(cli): Android apk name multi flavor dimensions parsing | ✅ 已合并 |
| `a8947492` | fix(android): remove kotlin-bom dependency | ✅ 已合并 |
| `06aeb9e8` | fix: make Plugin.resolve act consistently | ✅ 已合并 |
| `79ace5c7` | fix(cli): fix cap run command for yarn pnp mode | ✅ 已合并 |
| `60cf6667` | fix(android): add command not changing namespace | ✅ 已合并 |
| `b68ac9e2` | fix(android): replace deprecated Gradle property name syntax | ✅ 已合并 |
| `39120304` | fix(cli): replace deprecated Gradle property name syntax | ✅ 已合并 |
| `e48694b9` | fix(android-template): replace deprecated Gradle property name syntax | ✅ 已合并 |
| `0c7bcd3d` | fix(ios): Remove Cordova UIView extension | ✅ 已合并 |
| `b6abcb7d` | fix(ios): Silence WKProcessPool warning | ✅ 已合并 |
| `e76b29b7` | fix(ios): replace deprecation warnings | ✅ 已合并 |
| `62bd16f6` | fix(cli): prefer studio executable over studio.sh on linux | ✅ 已合并 |

---

## 待合并的提交 (可选)

### 安全的功能/文档更新

| 提交哈希 | 描述 | 状态 |
|----------|------|------|
| `b30c4724` | feat(cli): Select a cap run target by target name | ⏳ 待定 |
| `e8507cfe` | feat(iOS): Allow plugins to hook into WebView URL auth challenges | ⏳ 待定 |
| `ba05dd3d` | feat(android-template): Update google-services version | ⏳ 待定 |
| `5b27fdf4` | docs(core): fix typo in HttpResponse url description | ⏳ 待定 |
| `81f4416c` | chore: unify discord links | ⏳ 待定 |

### 需要评估

| 提交哈希 | 描述 | 风险 |
|----------|------|------|
| `81ae30a5` | feat(android): Improving SystemBars inset handling | 中 - 可能依赖 SystemBars 插件 |
| `2caaf905` | chore(android): Update gradle dependencies | 中 - 版本变化 |

---

## 不合并的提交

### Breaking Changes (带 `!` 标记)

| 提交哈希 | 描述 | 原因 |
|----------|------|------|
| `2975b96b` | fix(android)!: Adding keyboard insets handling | Breaking change |
| `abcbafa2` | feat(ios)!: emit CAPBridgeViewController notifications | Breaking change |
| `a0e713a1` | fix(ios)!: prevent double space typo in appendUserAgent | Breaking change |
| `c7072525` | chore(cli)!: require node >= 22 | 限制太严格 |
| `90c0ca58` | chore(android)!: Update default kotlin_version value | Breaking change |
| `ef11865d` | chore(android)!: Remove bridge_layout_main.xml | Breaking change |
| `60d27b80` | feat(cli)!: Make SPM default on add | Breaking change |
| `c44ef7e3` | feat(cli)!: bump minVersion to iOS 15 | 最低版本提升 |
| `5a13b260` | feat(ios)!: bump deployment target to 15 | 最低版本提升 |
| `18bacdb2` | feat(cli)!: Bump minSdkVersion to 24 | 最低版本提升 |
| `fc27e69d` | feat(android-template)!: added density to configChanges | Breaking change |
| `6430a52e` | feat(android)!: Bump compileSdkVersion to 36 | SDK 版本提升 |
| `6584c96f` | feat(android-template)!: Bump compile/targetSdkVersion to 36 | SDK 版本提升 |

### 8.0 特定功能

| 提交哈希 | 描述 | 原因 |
|----------|------|------|
| `a32216ac` | feat: System Bars Plugin | 8.0 新插件 |
| `ee8ba7bb` | fix(cli): make migrate update to 8.0.0 | 8.0 迁移逻辑 |
| `23303d46` | chore(cli): Update migrate command for Cap 8 | 8.0 迁移逻辑 |
| `a74a3643` | chore(cli): Add google-maps plugin to migrate command | 8.0 迁移逻辑 |
| `441208e6` | chore(cli): Add geolocation to migrate cmd | 8.0 迁移逻辑 |

### CI/发布相关

| 提交哈希 | 描述 | 原因 |
|----------|------|------|
| `1ef73a30` | Release 8.0.0 | 发布提交 |
| `d3c0c19f` | Release 8.0.0-beta.0 | 发布提交 |
| `bb138646` | Release 8.0.0-alpha.3 | 发布提交 |
| `88268dc0` | Release 8.0.0-alpha.2 | 发布提交 |
| `a571724c` | Release 8.0.0-alpha.1 | 发布提交 |
| `89283380` | chore(ci): upgrade GitHub Actions | CI 相关 |
| 其他 ci 提交 | ... | CI 相关 |

---

## 版本信息

- **基础版本**: Capacitor 7.4.4
- **参考版本**: Capacitor 8.0.0
- **Fork 版本**: aetherlink-capacitor-* 7.4.4
- **Fork 日期**: 2024-12-10

## npm 包

| 包名 | 版本 |
|------|------|
| `aetherlink-capacitor-core` | 7.4.4 |
| `aetherlink-capacitor-cli` | 7.4.4 |
| `aetherlink-capacitor-android` | 7.4.4 |
| `aetherlink-capacitor-ios` | 7.4.4 |

## GitHub 仓库

- https://github.com/1600822305/capacitor--
