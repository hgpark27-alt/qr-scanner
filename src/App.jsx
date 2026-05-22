import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import './App.css'

function parseLabel(raw) {
  // 제어문자(GS/RS 등) 제거
  const s = raw.replace(/[\x00-\x1f]/g, '')

  const pPos = s.indexOf('P')
  const tPos = s.indexOf('1T')
  const lPos = s.indexOf('L', tPos)

  // 엑셀 공식 동일 로직: MID(s, FIND("P")+12, FIND("1T")-FIND("P")-12)
  const pn = pPos >= 0 ? s.substring(pPos + 1, pPos + 11) : ''
  const sn = pPos >= 0 && tPos > pPos ? s.substring(pPos + 12, tPos) : ''
  const so = tPos >= 0 && lPos > tPos ? s.substring(tPos + 2, lPos) : ''

  return { pn, sn, so }
}

export default function App() {
  const [started, setStarted] = useState(false)
  const [items, setItems]     = useState([])
  const [error, setError]     = useState(null)
  const scannerRef = useRef(null)
  const seenRef    = useRef(new Set())
  const itemsRef   = useRef([])

  itemsRef.current = items

  const launch = async () => {
    setError(null)
    const scanner = new Html5Qrcode('reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ],
      useBarCodeDetectorIfSupported: true, // iOS 네이티브 인식 엔진
      verbose: false,
    })
    scannerRef.current = scanner

    try {
      await scanner.start(
        {
          facingMode: 'environment',
          width:  { ideal: 3840 },  // 최대 해상도 요청
          height: { ideal: 2160 },
        },
        { fps: 10 },
        (text) => {
          if (seenRef.current.has(text)) return
          seenRef.current.add(text)
          setItems(prev => [parseLabel(text), ...prev])
        },
        () => {}
      )
      setStarted(true)
    } catch {
      setError('카메라 권한을 허용해주세요.')
    }
  }

  const stop = () => {
    scannerRef.current?.stop().catch(() => {})
    setStarted(false)
  }

  const clearAll = () => {
    setItems([])
    seenRef.current.clear()
  }

  const handleShare = async () => {
    const text = [...items].reverse().map((it, i) =>
      `${i + 1}. S/N: ${it.sn || '-'} | P/N: ${it.pn || '-'} | S/O: ${it.so || '-'}`
    ).join('\n')
    if (navigator.share) {
      await navigator.share({ text })
    } else {
      await navigator.clipboard.writeText(text)
      alert('클립보드에 복사됐습니다')
    }
  }

  useEffect(() => () => { scannerRef.current?.stop().catch(() => {}) }, [])

  return (
    <div className="app">
      <div className="top-bar">
        <h1>QR 스캐너</h1>
        {items.length > 0 && (
          <div className="top-actions">
            <button className="btn-share" onClick={handleShare}>공유</button>
            <button className="btn-clear" onClick={clearAll}>초기화</button>
          </div>
        )}
      </div>

      {/* 카메라 영역 — 항상 DOM에 존재 */}
      <div className="scanner-wrap" style={{ display: started ? 'flex' : 'none' }}>
        <div id="reader" />
        <button className="btn-cancel" onClick={stop}>스캔 종료</button>
      </div>

      {!started && (
        <button className="btn-primary" onClick={launch}>📷 스캔 시작</button>
      )}

      {error && <p className="error">{error}</p>}

      {items.length > 0 && (
        <div className="results">
          <p className="count">인식 {items.length}개</p>
          {items.map((item, i) => (
            <div key={i} className="item">
              <span className="item-num">{items.length - i}</span>
              <div className="item-body">
                <p><b>S/N</b> {item.sn || '—'}</p>
                <p><b>P/N</b> {item.pn || '—'}</p>
                <p><b>S/O</b> {item.so || '—'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
