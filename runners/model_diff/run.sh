#!/usr/bin/env bash
# model_diff mock runner — 返回模拟的层比对数据
# 真实场景下这个脚本会加载 ONNX 模型做推理
# 用不同 Python 环境可以这样： /path/to/python3.10 analyze.py ...

INPUT=""
PARAMS=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --input) INPUT="$2"; shift 2 ;;
    --params) PARAMS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

echo '{
  "overall": {
    "totalLayers": 3,
    "passedLayers": 2,
    "failedLayers": 1,
    "avgCosineSimilarity": 0.956,
    "maxAbsError": 0.215,
    "worstLayer": "conv_23"
  },
  "layers": [
    {
      "layerName": "conv_1",
      "layerType": "Conv",
      "inputShape": [1,3,224,224],
      "outputShape": [1,64,112,112],
      "metrics": [
        {"frameworkId":"tensorrt","cosineSimilarity":0.999998,"maxAbsError":0.000012,"meanAbsError":0.000003,"relativeError":0.000005,"snr":42.3,"passed":true},
        {"frameworkId":"openvino","cosineSimilarity":0.999997,"maxAbsError":0.000018,"meanAbsError":0.000004,"relativeError":0.000007,"snr":41.1,"passed":true}
      ]
    },
    {
      "layerName": "conv_23",
      "layerType": "Conv",
      "inputShape": [1,512,14,14],
      "outputShape": [1,512,14,14],
      "metrics": [
        {"frameworkId":"tensorrt","cosineSimilarity":0.912300,"maxAbsError":0.215000,"meanAbsError":0.087600,"relativeError":0.123400,"snr":3.2,"passed":false},
        {"frameworkId":"openvino","cosineSimilarity":0.895600,"maxAbsError":0.242000,"meanAbsError":0.094300,"relativeError":0.135700,"snr":2.8,"passed":false}
      ]
    },
    {
      "layerName": "fc_output",
      "layerType": "Gemm",
      "inputShape": [1,2048],
      "outputShape": [1,1000],
      "metrics": [
        {"frameworkId":"tensorrt","cosineSimilarity":0.999996,"maxAbsError":0.000021,"meanAbsError":0.000005,"relativeError":0.000008,"snr":40.5,"passed":true},
        {"frameworkId":"openvino","cosineSimilarity":0.999995,"maxAbsError":0.000025,"meanAbsError":0.000006,"relativeError":0.000010,"snr":39.8,"passed":true}
      ]
    }
  ]
}'
