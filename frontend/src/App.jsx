import { useEffect, useMemo, useRef, useState } from 'react'

const LOG_STORAGE_KEY = 'vla-encrypt-log'
const INVALID_FILE_MESSAGE = 'Input file type is invalid.'

const formatTimestamp = (value) =>
    new Date(value).toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })

// Keep uniform activity for UI history and backend logging
const createActivityEntry = (level, message, target = '') => ({
    id: `${level}-${message}-${target}-${Date.now()}`,
    level,
    message,
    target,
    createdAt: new Date().toISOString(),
})

// One dropzone handles drag-drop and click imports
function Dropzone({
    title,
    file,
    onFileChange,
    onAction,
    onDiscard,
    actionLabel,
    dragging,
    onDragStateChange,
}) {
    const inputRef = useRef(null)

    const handleFiles = (files) => {
        const [nextFile] = Array.from(files || [])

        if (!nextFile) {
            onFileChange(null, INVALID_FILE_MESSAGE)
            return
        }

        onFileChange(nextFile, '')
    }

    const handleDrop = (event) => {
        event.preventDefault()
        onDragStateChange(false)

        if (!event.dataTransfer?.files?.length) {
            onFileChange(null, INVALID_FILE_MESSAGE)
            return
        }

        handleFiles(event.dataTransfer.files)
    }

    const handleInputChange = (event) => {
        handleFiles(event.target.files)
        event.target.value = ''
    }

    return (
        <div className="rounded-[24px] border border-stone-700 bg-stone-900/80 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-stone-200">{title}</h2>
                <div className="flex items-center gap-2">
                    {file ? (
                        <button
                            type="button"
                            onClick={onDiscard}
                            className="rounded-full border border-stone-700 bg-[#121110] px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                        >
                            X Discard
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onAction}
                        className="rounded-full border border-stone-600 bg-stone-800 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-100 transition hover:border-stone-500 hover:bg-stone-700"
                    >
                        {actionLabel}
                    </button>
                </div>
            </div>

            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                    event.preventDefault()
                    onDragStateChange(true)
                }}
                onDragLeave={() => onDragStateChange(false)}
                onDrop={handleDrop}
                className={`flex min-h-[200px] w-full flex-col items-center justify-center rounded-[20px] border border-dashed px-6 py-8 text-center transition ${dragging
                        ? 'border-stone-300 bg-stone-800'
                        : 'border-stone-700 bg-stone-950/60 hover:border-stone-500 hover:bg-stone-900'
                    }`}
            >
                <span className="text-sm font-medium uppercase tracking-[0.24em] text-stone-400">{title}</span>
                <span className="mt-4 text-base font-medium text-stone-100">
                    {file ? file.name : 'Drop file or browse'}
                </span>
                {file ? <span className="mt-2 text-xs text-stone-500">{formatTimestamp(file.lastModified)}</span> : null}
            </button>

            <input ref={inputRef} type="file" className="hidden" onChange={handleInputChange} />
        </div>
    )
}

function App() {
    const keyInputRef = useRef(null)
    const keyTypedLoggedRef = useRef(false)
    const [encryptFile, setEncryptFile] = useState(null)
    const [decryptFile, setDecryptFile] = useState(null)
    const [keyValue, setKeyValue] = useState('')
    const [notice, setNotice] = useState('')
    const [noticeTone, setNoticeTone] = useState('info')
    const [encryptDragging, setEncryptDragging] = useState(false)
    const [decryptDragging, setDecryptDragging] = useState(false)
    // Old log rows are normalized here so earlier localStorage data still renders
    const [logEntries, setLogEntries] = useState(() => {
        try {
            const saved = localStorage.getItem(LOG_STORAGE_KEY)
            if (!saved) return []

            const parsed = JSON.parse(saved)
            if (!Array.isArray(parsed)) {
                return []
            }

            return parsed.map((entry) => ({
                id: entry.id || `${entry.level || 'INFO'}-${entry.message || entry.filename || 'activity'}-${entry.createdAt || Date.now()}`,
                level: entry.level || 'INFO',
                message: entry.message || entry.filename || 'Activity',
                target: entry.target || '',
                createdAt: entry.createdAt || new Date().toISOString(),
            }))
        } catch {
            localStorage.removeItem(LOG_STORAGE_KEY)
            return []
        }
    })

    useEffect(() => {
        localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logEntries))
    }, [logEntries])

    const noticeClassName = useMemo(() => {
        if (noticeTone === 'error') {
            return 'border-red-900/60 bg-red-950/40 text-red-200'
        }

        if (noticeTone === 'success') {
            return 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200'
        }

        return 'border-stone-700 bg-stone-900/70 text-stone-300'
    }, [noticeTone])

    // Every UI action goes through logger so viewer state and .log stay in sync
    const appendLog = async (level, message, target = '') => {
        const entry = createActivityEntry(level, message, target)
        setLogEntries((current) => [entry, ...current].slice(0, 50))

        const logger = window?.go?.main?.App?.AppendActivityLog
        if (typeof logger === 'function') {
            try {
                await logger(level, message, target)
            } catch {
                setLogEntries((current) => [createActivityEntry('ERROR', 'log file write failed', '.log'), ...current].slice(0, 50))
            }
        }
    }

    const updateEncryptFile = (file, message) => {
        setEncryptFile(file)

        if (message) {
            setNoticeTone('error')
            setNotice(message)
            void appendLog('ERROR', 'invalid file type', 'encrypt')
            return
        }

        if (file) {
            setNoticeTone('info')
            setNotice(`Ready to encrypt ${file.name}.`)
            void appendLog('INFO', 'file selected', `encrypt ${file.name}`)
        }
    }

    const updateDecryptFile = (file, message) => {
        setDecryptFile(file)

        if (message) {
            setNoticeTone('error')
            setNotice(message)
            void appendLog('ERROR', 'invalid file type', 'decrypt')
            return
        }

        if (file) {
            setNoticeTone('info')
            setNotice(`Ready to decrypt ${file.name}.`)
            void appendLog('INFO', 'file selected', `decrypt ${file.name}`)
        }
    }

    const handleEncrypt = () => {
        if (!encryptFile) {
            setNoticeTone('error')
            setNotice(INVALID_FILE_MESSAGE)
            void appendLog('ERROR', 'encrypt failed', 'no file')
            return
        }

        setNoticeTone('success')
        setNotice(`Encrypted ${encryptFile.name}. Log saved without key.`)
        void appendLog('SUCCESS', 'encryption process', encryptFile.name)
    }

    const handleDecrypt = () => {
        if (!decryptFile) {
            setNoticeTone('error')
            setNotice(INVALID_FILE_MESSAGE)
            void appendLog('ERROR', 'decrypt failed', 'no file')
            return
        }

        if (!keyValue.trim()) {
            setNoticeTone('error')
            setNotice('Enter decryption key before decryption starts.')
            keyInputRef.current?.focus()
            void appendLog('ERROR', 'missing key', decryptFile.name)
            return
        }

        setNoticeTone('success')
        setNotice(`Decryption started for ${decryptFile.name}.`)
        void appendLog('SUCCESS', 'decryption process', decryptFile.name)
    }

    const handleEncryptDiscard = () => {
        if (encryptFile) {
            void appendLog('INFO', 'file discarded', `encrypt ${encryptFile.name}`)
        }
        setEncryptFile(null)
        setNoticeTone('info')
        setNotice('Encrypt file discarded.')
    }

    const handleDecryptDiscard = () => {
        if (decryptFile) {
            void appendLog('INFO', 'file discarded', `decrypt ${decryptFile.name}`)
        }
        setDecryptFile(null)
        setNoticeTone('info')
        setNotice('Decrypt file discarded.')
    }

    // Sent to Go backend because it can read clipboard text that existed before app launched
    const handlePasteFromClipboard = async () => {
        try {
            let clipboardText = ''

            if (typeof window !== 'undefined' && window.go?.main?.App?.GetClipboardText) {
                clipboardText = await window.go.main.App.GetClipboardText()
            } else if (navigator.clipboard?.readText) {
                clipboardText = await navigator.clipboard.readText()
            } else {
                throw new Error('clipboard unavailable')
            }

            if (!clipboardText.trim()) {
                setNoticeTone('error')
                setNotice('Clipboard is empty.')
                void appendLog('ERROR', 'clipboard empty', 'key')
                return
            }

            keyTypedLoggedRef.current = true
            setKeyValue(clipboardText)
            setNoticeTone('success')
            setNotice('Key pasted from clipboard.')
            void appendLog('SUCCESS', 'key pasted', 'clipboard')
        } catch (error) {
            console.error(error)
            setNoticeTone('error')
            setNotice('Clipboard access failed.')
            void appendLog('ERROR', 'clipboard access failed', 'key')
        }
    }

    const handleKeyValueChange = (event) => {
        const nextValue = event.target.value
        setKeyValue(nextValue)

        if (!nextValue.trim()) {
            keyTypedLoggedRef.current = false
            return
        }

        if (!keyTypedLoggedRef.current) {
            keyTypedLoggedRef.current = true
            void appendLog('INFO', 'key entered', 'manual input')
        }
    }

    return (
        <div className="min-h-screen bg-[#191715] px-4 py-10 text-stone-100">
            <div className="mx-auto w-full max-w-5xl rounded-[32px] border border-stone-800 bg-[#211f1c] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] md:p-8">
                <div className="mb-8">
                    <h1 className="text-3xl font-semibold tracking-[-0.03em] text-stone-100 md:text-4xl">Encryption Menu</h1>
                </div>

                {/* File action panels */}
                <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                    <Dropzone
                        title="Encrypt"
                        file={encryptFile}
                        onFileChange={updateEncryptFile}
                        onAction={handleEncrypt}
                        onDiscard={handleEncryptDiscard}
                        actionLabel="Encrypt"
                        dragging={encryptDragging}
                        onDragStateChange={setEncryptDragging}
                    />

                    <Dropzone
                        title="Decrypt"
                        file={decryptFile}
                        onFileChange={updateDecryptFile}
                        onAction={handleDecrypt}
                        onDiscard={handleDecryptDiscard}
                        actionLabel="Decrypt"
                        dragging={decryptDragging}
                        onDragStateChange={setDecryptDragging}
                    />
                </div>

                {/* Key input and live activity viewer */}
                <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="min-h-[252px] rounded-[24px] border border-stone-800 bg-[#1b1917] p-5">
                        <div className="flex items-center justify-between gap-3">
                            <label htmlFor="keyValue" className="text-sm font-medium uppercase tracking-[0.22em] text-stone-300">
                                Key
                            </label>
                            <button
                                type="button"
                                onClick={handlePasteFromClipboard}
                                className="rounded-full border border-stone-700 bg-[#121110] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                            >
                                Paste From Clipboard
                            </button>
                        </div>
                        <input
                            ref={keyInputRef}
                            id="keyValue"
                            type="password"
                            value={keyValue}
                            onChange={handleKeyValueChange}
                            placeholder="Enter key"
                            className="mt-4 w-full rounded-[18px] border border-stone-700 bg-[#121110] px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-stone-500 focus:ring-2 focus:ring-stone-500/20"
                        />

                        <div className={`mt-4 rounded-[18px] border px-4 py-3 text-sm ${noticeClassName}`}>
                            {notice || 'Status bar'}
                        </div>
                    </div>

                    <div className="min-h-[252px] rounded-[24px] border border-stone-800 bg-[#1b1917] p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 className="text-sm font-medium uppercase tracking-[0.22em] text-stone-200">Live Activity Log</h2>
                            <button
                                type="button"
                                onClick={() => setLogEntries([])}
                                className="rounded-full border border-stone-700 bg-[#121110] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
                            >
                                Clear
                            </button>
                        </div>

                        <div className="h-[220px] space-y-2 overflow-y-auto pr-1">
                            {logEntries.length ? (
                                logEntries.map((entry) => (
                                    <div key={entry.id} className="rounded-[14px] border border-stone-800 bg-[#121110] px-3 py-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span
                                                        className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] ${entry.level === 'ERROR'
                                                                ? 'bg-red-950/60 text-red-200'
                                                                : entry.level === 'SUCCESS'
                                                                    ? 'bg-emerald-950/50 text-emerald-200'
                                                                    : 'bg-stone-800 text-stone-300'
                                                            }`}
                                                    >
                                                        {entry.level}
                                                    </span>
                                                    <p className="truncate text-xs font-medium text-stone-100">{entry.message}</p>
                                                </div>
                                                {entry.target ? <p className="mt-1 text-[11px] text-stone-500">{entry.target}</p> : null}
                                            </div>
                                            <span className="shrink-0 text-[11px] text-stone-500">{formatTimestamp(entry.createdAt)}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="rounded-[14px] border border-dashed border-stone-700 bg-[#121110] px-3 py-4 text-sm text-stone-500">
                                    Empty
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App
