# 固定源码的 MinIO CI 夹具

## 为什么变更

2026-09-25 企业云运行 `36088522347` 在拉取 MinIO / mc 时返回 `unauthorized`，两个应用未启动，业务审计均未执行。这不是 21 个业务缺陷，也不是业务通过。

只读复核官方 Quay 的匿名鉴权后仍无法读取这两个固定标签的 manifest；官方 `dl.min.io` 历史 server / client 校验和下载均返回 HTTP 410。官方仓库说明社区版本已转为源码分发并停止维护：

- https://github.com/minio/minio
- https://github.com/minio/mc

不使用未知镜像仓库、不关闭 TLS、不改用 `latest`。这个 Dockerfile **仅用于隔离 CI**，继续使用原验收基线对应的源码版本，不是生产依赖的维护承诺，也没有替换正式环境的对象存储。

## 固定来源

- MinIO `RELEASE.2025-04-22T22-12-26Z` → `0d7408fc9969caf07de6a8c3a84f9fbb10a6739e`
- mc `RELEASE.2025-04-16T18-13-26Z` → `b00526b153a31b36767991a4f5ce2cced435ee8e`
- Go 1.24.2 与 Debian Bookworm slim 基础镜像均固定官方 registry manifest digest。
- Git 获取后校验实际 HEAD；模块使用上游 go.sum 和 `go mod verify`，保留许可文件与源码提交标签。

源码版本已通过官方 Git 标签解析核验。源码构建、S3 健康、双端故障切换仍必须由新一轮企业云实测确认，不能只凭 Dockerfile 或契约测试声称恢复。

## 使用

设置现有沙箱环境变量后，在仓库根目录运行：

```sh
export COMPOSE_FILE=ops/cloud-sandbox/docker-compose.yml
docker compose pull --ignore-buildable
docker compose build minio-primary
docker compose up -d --wait --wait-timeout 180
```

三个 MinIO 服务共用本地构建的镜像，不向 Docker Hub 请求项目私有镜像名。企业云与发布认证工作流均先构建再启动。独立进程的健康检查、对象上传/下载和失败切换检查维持原门槛。
