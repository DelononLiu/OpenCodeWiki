export function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export function extractArch(name: string) {
  const n = name.toLowerCase()
  if (n.includes('resnet')) return 'ResNet (CNN)'
  if (n.includes('yolo')) return 'YOLO (CNN)'
  if (n.includes('bert')) return 'BERT (Transformer)'
  if (n.includes('efficientnet')) return 'EfficientNet (CNN)'
  if (n.includes('mobilenet')) return 'MobileNet (CNN)'
  if (n.includes('deeplab')) return 'DeepLab (CNN)'
  if (n.includes('vit') || n.includes('swin')) return 'ViT (Transformer)'
  if (n.includes('convnext')) return 'ConvNeXt (CNN)'
  if (n.includes('whisper')) return 'Whisper (Transformer)'
  if (n.includes('sd') || n.includes('stable')) return 'Stable Diffusion (UNet)'
  if (n.includes('wav2vec')) return 'wav2vec 2.0 (Transformer)'
  if (n.includes('clip')) return 'CLIP (Transformer)'
  if (n.includes('sam')) return 'SAM (Transformer)'
  return 'Unknown'
}

export function mockParams(name: string) {
  const n = name.toLowerCase()
  if (n.includes('resnet50')) return '25.6M'
  if (n.includes('yolov8')) return '11.2M'
  if (n.includes('bert')) return '110M'
  if (n.includes('efficientnet')) return '5.3M'
  if (n.includes('mobilenet')) return '4.2M'
  if (n.includes('deeplab')) return '59M'
  if (n.includes('vit')) return '86M'
  if (n.includes('swin')) return '50M'
  if (n.includes('convnext')) return '88M'
  if (n.includes('whisper')) return '769M'
  if (n.includes('sd') || n.includes('stable')) return '860M'
  if (n.includes('wav2vec')) return '317M'
  if (n.includes('clip')) return '428M'
  if (n.includes('sam')) return '641M'
  return '—'
}
