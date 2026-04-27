package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.design/x/clipboard"
	"golang.org/x/crypto/argon2"
)

const (
	logFileName             = ".log"
	envelopeMagic           = "VLAE"
	envelopeVersion  byte   = 1
	saltSize                = 16
	nonceSize               = 12
	argonTime        uint32 = 1
	argonMemory      uint32 = 64 * 1024
	argonThreads     uint8  = 4
	argonKeyLength   uint32 = 32
	generatedKeySize        = 32
	randomOrgURL            = "https://www.random.org/integers/?num=64&min=0&max=255&col=1&base=10&format=plain&rnd=new"
	anuURL                  = "https://qrng.anu.edu.au/API/jsonI.php?length=64&type=uint8"
)

var (
	errEmptyPassword     = errors.New("key is required")
	errInvalidEnvelope   = errors.New("encrypted file format is invalid")
	errInvalidPayload    = errors.New("encrypted payload is invalid")
	errUnsupportedFormat = errors.New("encrypted file version is unsupported")
)

type App struct {
	ctx            context.Context
	logMutex       sync.Mutex
	clipboardReady bool
	clipboardError string
}

type FileSelection struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type EntropyLog struct {
	Level   string `json:"level"`
	Message string `json:"message"`
	Target  string `json:"target"`
}

type EncryptionResult struct {
	GeneratedKey string       `json:"generatedKey"`
	EntropyLogs  []EntropyLog `json:"entropyLogs"`
}

type entropySource struct {
	name    string
	collect func() ([]byte, error)
}

type sourceResult struct {
	name string
	data []byte
	err  error
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	if err := clipboard.Init(); err != nil {
		a.clipboardError = err.Error()
		return
	}

	a.clipboardReady = true
}

func sanitizeLogValue(value string) string {
	cleaned := strings.ReplaceAll(value, "\n", " ")
	cleaned = strings.ReplaceAll(cleaned, "\r", " ")
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return "-"
	}
	return cleaned
}

func (a *App) AppendActivityLog(level string, message string, target string) error {
	a.logMutex.Lock()
	defer a.logMutex.Unlock()

	entry := fmt.Sprintf(
		"%s | %s | %s | %s\n",
		sanitizeLogValue(level),
		sanitizeLogValue(message),
		sanitizeLogValue(target),
		time.Now().Format(time.RFC3339),
	)

	file, err := os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = file.WriteString(entry)
	return err
}

func (a *App) GetClipboardText() (string, error) {
	if !a.clipboardReady {
		if a.clipboardError != "" {
			return "", errors.New(a.clipboardError)
		}
		return "", fmt.Errorf("clipboard unavailable")
	}

	text := clipboard.Read(clipboard.FmtText)
	if len(text) == 0 {
		return "", nil
	}

	return string(text), nil
}

func (a *App) SetClipboardText(value string) error {
	if !a.clipboardReady {
		if a.clipboardError != "" {
			return errors.New(a.clipboardError)
		}
		return fmt.Errorf("clipboard unavailable")
	}

	clipboard.Write(clipboard.FmtText, []byte(value))
	return nil
}

func (a *App) PickFile() (*FileSelection, error) {
	selectedPath, err := wailsruntime.OpenFileDialog(
		a.requestContext(),
		wailsruntime.OpenDialogOptions{
			Title: "Select file",
		},
	)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(selectedPath) == "" {
		return nil, nil
	}

	return &FileSelection{
		Path: selectedPath,
		Name: filepath.Base(selectedPath),
	}, nil
}

func (a *App) EncryptFileInPlace(filePath string, password string) (*EncryptionResult, error) {
	if strings.TrimSpace(filePath) == "" {
		return nil, fmt.Errorf("file path is required")
	}

	plaintext, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	salt, err := randomBytes(saltSize)
	if err != nil {
		return nil, err
	}

	seed, entropyLogs, err := a.collectEntropySeed()
	if err != nil {
		return nil, err
	}

	mixedSeed := append([]byte(nil), seed...)
	// The optional user key must influence the derived key before we derive the final decrypt secret.
	if strings.TrimSpace(password) != "" {
		passwordMix := sha512.Sum512(append(append([]byte{}, seed...), []byte(password)...))
		mixedSeed = passwordMix[:]
		a.appendEntropyLog(
			&entropyLogs,
			"INFO",
			"[entropy] user key mixed into seed before derivation",
			"key",
		)
	}

	generatedSecret := deriveSecretKey(mixedSeed)
	// The returned key must be the exact value the user pastes back during decryption.
	generatedKey := hex.EncodeToString(generatedSecret)
	nonce := deriveNonce(mixedSeed)

	payload, err := encodePlaintextPayload(filepath.Base(filePath), plaintext)
	if err != nil {
		return nil, err
	}

	ciphertext, err := encryptPayload(generatedKey, salt, nonce, payload)
	if err != nil {
		return nil, err
	}

	// The envelope stores everything decryption needs without changing the file name.
	envelope := make([]byte, 0, len(envelopeMagic)+1+saltSize+nonceSize+len(ciphertext))
	envelope = append(envelope, envelopeMagic...)
	envelope = append(envelope, envelopeVersion)
	envelope = append(envelope, salt...)
	envelope = append(envelope, nonce...)
	envelope = append(envelope, ciphertext...)

	if err := writeFileDirectly(filePath, envelope); err != nil {
		return nil, err
	}

	return &EncryptionResult{
		GeneratedKey: generatedKey,
		EntropyLogs:  entropyLogs,
	}, nil
}

func (a *App) DecryptFileInPlace(filePath string, password string) error {
	if strings.TrimSpace(filePath) == "" {
		return fmt.Errorf("file path is required")
	}
	if strings.TrimSpace(password) == "" {
		return errEmptyPassword
	}

	encryptedData, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("read file: %w", err)
	}

	salt, nonce, ciphertext, err := parseEnvelope(encryptedData)
	if err != nil {
		return err
	}

	plaintext, err := decryptPayload(password, salt, nonce, ciphertext)
	if err != nil {
		return err
	}

	_, fileBytes, err := decodePlaintextPayload(plaintext)
	if err != nil {
		return err
	}

	return writeFileDirectly(filePath, fileBytes)
}

func encryptPayload(password string, salt []byte, nonce []byte, plaintext []byte) ([]byte, error) {
	key := argon2.IDKey(
		[]byte(password),
		salt,
		argonTime,
		argonMemory,
		argonThreads,
		argonKeyLength,
	)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create aes cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create gcm cipher: %w", err)
	}

	return gcm.Seal(nil, nonce, plaintext, nil), nil
}

func decryptPayload(password string, salt []byte, nonce []byte, ciphertext []byte) ([]byte, error) {
	key := argon2.IDKey(
		[]byte(password),
		salt,
		argonTime,
		argonMemory,
		argonThreads,
		argonKeyLength,
	)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create aes cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create gcm cipher: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt file: %w", err)
	}

	return plaintext, nil
}

func encodePlaintextPayload(fileName string, fileBytes []byte) ([]byte, error) {
	nameBytes := []byte(fileName)
	// Hnadle edge cases
	if len(nameBytes) == 0 {
		return nil, fmt.Errorf("file name is required")
	}
	if len(nameBytes) > 0xffff {
		return nil, fmt.Errorf("file name is too long")
	}

	payload := make([]byte, 2+len(nameBytes)+len(fileBytes))
	binary.BigEndian.PutUint16(payload[:2], uint16(len(nameBytes)))
	copy(payload[2:], nameBytes)
	copy(payload[2+len(nameBytes):], fileBytes)
	return payload, nil
}

func decodePlaintextPayload(payload []byte) (string, []byte, error) {
	if len(payload) < 2 {
		return "", nil, errInvalidPayload
	}

	nameLength := int(binary.BigEndian.Uint16(payload[:2]))
	if nameLength == 0 || len(payload) < 2+nameLength {
		return "", nil, errInvalidPayload
	}

	fileName := string(payload[2 : 2+nameLength])
	fileBytes := append([]byte(nil), payload[2+nameLength:]...)
	return fileName, fileBytes, nil
}

func parseEnvelope(data []byte) ([]byte, []byte, []byte, error) {
	headerSize := len(envelopeMagic) + 1 + saltSize + nonceSize
	if len(data) <= headerSize {
		return nil, nil, nil, errInvalidEnvelope
	}
	if string(data[:len(envelopeMagic)]) != envelopeMagic {
		return nil, nil, nil, errInvalidEnvelope
	}
	if data[len(envelopeMagic)] != envelopeVersion {
		return nil, nil, nil, errUnsupportedFormat
	}

	offset := len(envelopeMagic) + 1
	salt := append([]byte(nil), data[offset:offset+saltSize]...)
	offset += saltSize
	nonce := append([]byte(nil), data[offset:offset+nonceSize]...)
	offset += nonceSize
	ciphertext := append([]byte(nil), data[offset:]...)

	if len(ciphertext) == 0 {
		return nil, nil, nil, errInvalidEnvelope
	}

	return salt, nonce, ciphertext, nil
}

func (a *App) collectEntropySeed() ([]byte, []EntropyLog, error) {
	sources := []entropySource{
		{name: "crypto/rand", collect: collectCSPRNG},
		{name: "timestamp", collect: collectTimestamp},
		{name: "ANU Quantum", collect: collectANU},
		{name: "random.org", collect: collectRandomOrg},
	}

	logs := make([]EntropyLog, 0, len(sources)+4)
	hasher := sha512.New()

	anchor, err := randomBytes(64)
	if err != nil {
		return nil, nil, fmt.Errorf("crypto/rand failed (fatal): %w", err)
	}
	hasher.Write(anchor)
	a.appendEntropyLog(&logs, "SUCCESS", "[entropy] crypto/rand anchor mixed in", "key")

	results := make(chan sourceResult, len(sources))
	for _, source := range sources {
		source := source
		go func() {
			data, err := source.collect()
			results <- sourceResult{name: source.name, data: data, err: err}
		}()
	}

	externalFailures := 0
	for range sources {
		result := <-results
		if result.err != nil {
			a.appendEntropyLog(
				&logs,
				"ERROR",
				fmt.Sprintf("[entropy] %s unavailable", result.name),
				result.err.Error(),
			)
			if result.name == "ANU Quantum" || result.name == "random.org" {
				externalFailures += 1
			}
			continue
		}

		hasher.Write(result.data)
		a.appendEntropyLog(
			&logs,
			"SUCCESS",
			fmt.Sprintf("[entropy] %s mixed in", result.name),
			"key",
		)
	}

	finalTimestamp := make([]byte, 8)
	binary.LittleEndian.PutUint64(finalTimestamp, uint64(time.Now().UnixNano()))
	hasher.Write(finalTimestamp)
	a.appendEntropyLog(&logs, "INFO", "[entropy] final timestamp jitter mixed in", "key")

	if externalFailures == 2 {
		a.appendEntropyLog(
			&logs,
			"INFO",
			"[entropy] external sources unavailable, local entropy used",
			"key",
		)
	}

	seed := hasher.Sum(nil)
	return seed, logs, nil
}

// combine all existing data into simple sha512 key
func deriveSecretKey(seed []byte) []byte {
	derived := sha512.Sum512(append(append([]byte{}, seed...), []byte("key")...))
	return derived[:generatedKeySize]
}

func deriveNonce(seed []byte) []byte {
	derived := sha512.Sum512(append(append([]byte{}, seed...), []byte("nonce")...))
	nonce := make([]byte, nonceSize)
	copy(nonce, derived[:nonceSize])
	return nonce
}

func (a *App) appendEntropyLog(logs *[]EntropyLog, level string, message string, target string) {
	entry := EntropyLog{Level: level, Message: message, Target: target}
	*logs = append(*logs, entry)
	_ = a.AppendActivityLog(level, message, target)
}

func collectCSPRNG() ([]byte, error) {
	return randomBytes(64)
}

// Timestamp entropy logic
func collectTimestamp() ([]byte, error) {
	buffer := new(bytes.Buffer)

	wallClock := make([]byte, 8)
	binary.LittleEndian.PutUint64(wallClock, uint64(time.Now().UnixNano()))
	buffer.Write(wallClock)

	monotonicClock := make([]byte, 8)
	binary.LittleEndian.PutUint64(monotonicClock, uint64(time.Since(time.Time{}).Nanoseconds()))
	buffer.Write(monotonicClock)

	goroutines := make([]byte, 4)
	binary.LittleEndian.PutUint32(goroutines, uint32(goruntime.NumGoroutine()))
	buffer.Write(goroutines)

	cpus := make([]byte, 4)
	binary.LittleEndian.PutUint32(cpus, uint32(goruntime.NumCPU()))
	buffer.Write(cpus)

	return buffer.Bytes(), nil
}

// ANU quantum fluctuations for entropy logic
//
//	The random numbers are generated in real-time in our lab by measuring the quantum fluctuations of the vacuum
func collectANU() ([]byte, error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, anuURL, nil)
	if err != nil {
		return nil, err
	}

	response, err := (&http.Client{Timeout: 4 * time.Second}).Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ANU returned HTTP %d", response.StatusCode)
	}

	var result struct {
		Data    []int `json:"data"`
		Success bool  `json:"success"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return nil, err
	}
	if !result.Success || len(result.Data) == 0 {
		return nil, fmt.Errorf("ANU returned no data")
	}

	bytes := make([]byte, len(result.Data))
	for index, value := range result.Data {
		bytes[index] = byte(value)
	}
	return bytes, nil
}

// Using Atmospheric RNG
func collectRandomOrg() ([]byte, error) {
	request, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		randomOrgURL,
		nil,
	)
	if err != nil {
		return nil, err
	}

	response, err := (&http.Client{Timeout: 4 * time.Second}).Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusServiceUnavailable {
		return nil, fmt.Errorf("random.org quota exceeded")
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("random.org returned HTTP %d", response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		return nil, err
	}

	values := strings.Split(strings.TrimSpace(string(body)), "\n")
	bytes := make([]byte, 0, len(values))
	for _, value := range values {
		number, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			continue
		}
		if number < 0 || number > 255 {
			continue
		}
		bytes = append(bytes, byte(number))
	}
	if len(bytes) == 0 {
		return nil, fmt.Errorf("random.org returned no parseable data")
	}
	return bytes, nil
}

func (a *App) requestContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func randomBytes(size int) ([]byte, error) {
	bytes := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, bytes); err != nil {
		return nil, fmt.Errorf("read random bytes: %w", err)
	}
	return bytes, nil
}

func writeFileDirectly(filePath string, data []byte) error {
	// Direct overwrite keeps the code simple, but can corrupt the original file.
	return os.WriteFile(filePath, data, 0o644)
}
