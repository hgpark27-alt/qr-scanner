import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import './App.css'

export default function App() {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const scannerRef = useRef(null)

  const startScan = () => {
    setError(null)
    setResult(null)
    setScanning(true)
  }

  const stopScan = () => {
    scannerRef.current?.stop().catch(() => {})
    setScanning(false)
  }

  useEffect(() => {
    if (!scanning) return

    const scanner = new Html5Qrcode('reader')
    scannerRef.current = scanner

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (text) => {
        scanner.stop().then(() => {
          setScanning(false)
          setResult(text)
        })
      },
      () => {}
    ).catch((err) => {
      setError('카메라 접근 실패. 카메라 권한을 허용해주세요.\n' + err)
      setScanning(false)
    })

    return () => { scanner.stop().catch(() => {}) }
  }, [scanning])

  const formatResult = (raw) => {
    return raw.split(/[\n|,]/).map(s => s.trim()).filter(Boolean)
  }

  const handleShare = async () => {
    const text = formatResult(result).join('\n')
    if (navigator.share) {
      await navigator.share({ text })
    } else {
      await navigator.clipboard.writeText(text)
      alert('클립보드에 복사됐습니다')
    }
  }

  return (
    <div className="app">
      <h1>QR 스캐너</h1>

      {!scanning && !result && (
        <button className="btn-primary" onClick={startScan}>
          📷 QR 스캔 시작
        </button>
      )}

      {scanning && (
        <div className="scanner-wrap">
          <div id="reader" />
          <button className="btn-cancel" onClick={stopScan}>취소</button>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result-wrap">
          <div className="result-box">
            {formatResult(result).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={handleShare}>공유하기</button>
            <button className="btn-secondary" onClick={() => setResult(null)}>다시 스캔</button>
          </div>
        </div>
      )}
    </div>
  )
}
