# Deployment

## Windows Local Pilot

The packaged artifact is currently a Windows local pilot package.

Default entry:

```text
http://127.0.0.1:5001/
```

Default runtime data root:

```text
D:\AilaoDaRuntime
```

If a workstation has no usable `D:` drive, do not patch source code by hand. Use a governed migration drill and record the chosen runtime path before moving business data.

## Linux / Docker / Cloud

Do not treat the Windows local package as a Linux server package.

Linux or Docker deployment requires:

- Prisma Client generated for the target platform
- `prisma validate` passed on the target build runner
- target database path or PostgreSQL connection configured explicitly
- backup, upload, and log paths mounted outside the container image
- release verification run after startup

The Prisma schema includes `binaryTargets = ["native", "windows", "debian-openssl-3.0.x"]` so a fresh generate step can support Windows and Debian OpenSSL 3 runners. The generated client inside a prebuilt Windows package is still not proof of Linux readiness.
