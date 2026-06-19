#!/usr/bin/env node
/**
 * postinstall.mjs — npm install 后自动处理
 *
 * 解决内网环境 sharp/libvips 下载问题。
 * 用法: npm install --ignore-scripts && node scripts/postinstall.mjs
 *
 * 流程:
 *   1. 从 vendor/libvips-*.tar.br 提取到 sharp/vendor/
 *   2. 重建 sharp 原生模块（prebuild-install 或 node-gyp）
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

console.log('[postinstall] 开始...');

// ── 1. 提取 libvips ──

const LOCAL_LIBVIPS = path.join(ROOT, 'vendor', 'libvips-8.14.5-linux-x64.tar.br');
const SHARP_VENDOR_DIR = path.join(ROOT, 'node_modules', 'sharp', 'vendor', '8.14.5');

if (fs.existsSync(LOCAL_LIBVIPS)) {
  // 检查 libvips 是否已提取
  const libvipsSo = path.join(SHARP_VENDOR_DIR, 'lib', 'libvips-cpp.so.42');
  if (!fs.existsSync(libvipsSo)) {
    console.log('[postinstall] 提取 libvips...');
    fs.mkdirSync(path.dirname(SHARP_VENDOR_DIR), { recursive: true });
    try {
      execSync(
        `tar --use-compress-program=brotli -xf "${LOCAL_LIBVIPS}" -C "${path.dirname(SHARP_VENDOR_DIR)}/"`,
        { stdio: 'pipe', timeout: 30000 }
      );
      console.log('[postinstall] ✓ libvips 已提取');
    } catch (e) {
      console.warn('[postinstall] ⚠ libvips 解压失败:', e.message);
    }
  } else {
    console.log('[postinstall] libvips 已就绪');
  }
} else {
  console.log('[postinstall] vendor/libvips 不存在，跳过');
}

// ── 2. 构建 sharp 原生模块 ──

const sharpNode = path.join(ROOT, 'node_modules', 'sharp', 'build', 'Release', 'sharp-linux-x64.node');
if (fs.existsSync(path.join(ROOT, 'node_modules', 'sharp'))) {
  if (!fs.existsSync(sharpNode)) {
    console.log('[postinstall] 构建 sharp 原生模块...');
    // 先试 prebuild-install（下载预编译包）
    try {
      execSync('npx prebuild-install || node-gyp rebuild', {
        cwd: path.join(ROOT, 'node_modules', 'sharp'),
        stdio: 'pipe',
        timeout: 120000,
      });
      console.log('[postinstall] ✓ sharp 构建完成');
    } catch (e) {
      console.warn('[postinstall] ⚠ sharp 构建失败:', e.message);
      console.warn('[postinstall] 嵌入模型将无法使用 @xenova/transformers');
    }
  } else {
    console.log('[postinstall] sharp 已就绪');
  }
}

console.log('[postinstall] 完成');
