export class CDPError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CDPError'
  }
}

export class CDPConnectionError extends CDPError {
  constructor(message: string) {
    super(message)
    this.name = 'CDPConnectionError'
  }
}

export class CDPDomainError extends CDPError {
  constructor(domain: string, message: string) {
    super(`${domain}: ${message}`)
    this.name = 'CDPDomainError'
  }
}

export class ScreenshotCaptureError extends CDPError {
  constructor(message: string) {
    super(message)
    this.name = 'ScreenshotCaptureError'
  }
}

export class RuntimeCaptureError extends CDPError {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeCaptureError'
  }
}

export class DOMSnapshotCaptureError extends CDPError {
  constructor(message: string) {
    super(message)
    this.name = 'DOMSnapshotCaptureError'
  }
}
