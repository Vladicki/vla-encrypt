package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestEncodeDecodePlaintextPayload(t *testing.T) {
	fileName := "sample.txt"
	fileBytes := []byte("hello world")

	payload, err := encodePlaintextPayload(fileName, fileBytes)
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}

	decodedName, decodedBytes, err := decodePlaintextPayload(payload)
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}

	if decodedName != fileName {
		t.Fatalf("decoded name mismatch: got %q want %q", decodedName, fileName)
	}
	if !bytes.Equal(decodedBytes, fileBytes) {
		t.Fatalf("decoded bytes mismatch: got %q want %q", decodedBytes, fileBytes)
	}
}

func TestEncryptDecryptPayloadRoundTrip(t *testing.T) {
	password := "derived-key"
	salt := bytes.Repeat([]byte{1}, saltSize)
	nonce := bytes.Repeat([]byte{2}, nonceSize)
	plaintext := []byte("round trip plaintext")

	ciphertext, err := encryptPayload(password, salt, nonce, plaintext)
	if err != nil {
		t.Fatalf("encrypt payload: %v", err)
	}

	decrypted, err := decryptPayload(password, salt, nonce, ciphertext)
	if err != nil {
		t.Fatalf("decrypt payload: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Fatalf("decrypted payload mismatch: got %q want %q", decrypted, plaintext)
	}
}

func TestParseEnvelope(t *testing.T) {
	salt := bytes.Repeat([]byte{3}, saltSize)
	nonce := bytes.Repeat([]byte{4}, nonceSize)
	ciphertext := []byte("ciphertext")

	envelope := make([]byte, 0, len(envelopeMagic)+1+saltSize+nonceSize+len(ciphertext))
	envelope = append(envelope, envelopeMagic...)
	envelope = append(envelope, envelopeVersion)
	envelope = append(envelope, salt...)
	envelope = append(envelope, nonce...)
	envelope = append(envelope, ciphertext...)

	parsedSalt, parsedNonce, parsedCiphertext, err := parseEnvelope(envelope)
	if err != nil {
		t.Fatalf("parse envelope: %v", err)
	}

	if !bytes.Equal(parsedSalt, salt) {
		t.Fatalf("salt mismatch")
	}
	if !bytes.Equal(parsedNonce, nonce) {
		t.Fatalf("nonce mismatch")
	}
	if !bytes.Equal(parsedCiphertext, ciphertext) {
		t.Fatalf("ciphertext mismatch")
	}
}

func TestParseEnvelopeRejectsInvalidMagic(t *testing.T) {
	_, _, _, err := parseEnvelope([]byte("bad data"))
	if err == nil {
		t.Fatal("expected invalid envelope error")
	}
}

func TestDecryptFileInPlaceRejectsEmptyPassword(t *testing.T) {
	app := NewApp()
	err := app.DecryptFileInPlace("file.txt", "")
	if err == nil {
		t.Fatal("expected empty password error")
	}
	if err != errEmptyPassword {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWriteFileDirectly(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "file.txt")
	content := []byte("direct overwrite")

	if err := writeFileDirectly(filePath, content); err != nil {
		t.Fatalf("write file directly: %v", err)
	}

	written, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}

	if !bytes.Equal(written, content) {
		t.Fatalf("written bytes mismatch: got %q want %q", written, content)
	}
}

func TestDecryptFileInPlaceRoundTrip(t *testing.T) {
	password := "derived-key"
	plainName := "note.txt"
	plainBytes := []byte("secret note")
	salt := bytes.Repeat([]byte{7}, saltSize)
	nonce := bytes.Repeat([]byte{8}, nonceSize)

	payload, err := encodePlaintextPayload(plainName, plainBytes)
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}

	ciphertext, err := encryptPayload(password, salt, nonce, payload)
	if err != nil {
		t.Fatalf("encrypt payload: %v", err)
	}

	envelope := make([]byte, 0, len(envelopeMagic)+1+saltSize+nonceSize+len(ciphertext))
	envelope = append(envelope, envelopeMagic...)
	envelope = append(envelope, envelopeVersion)
	envelope = append(envelope, salt...)
	envelope = append(envelope, nonce...)
	envelope = append(envelope, ciphertext...)

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, plainName)
	if err := os.WriteFile(filePath, envelope, 0o644); err != nil {
		t.Fatalf("seed encrypted file: %v", err)
	}

	app := NewApp()
	if err := app.DecryptFileInPlace(filePath, password); err != nil {
		t.Fatalf("decrypt file in place: %v", err)
	}

	decryptedBytes, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read decrypted file: %v", err)
	}

	if !bytes.Equal(decryptedBytes, plainBytes) {
		t.Fatalf("decrypted file mismatch: got %q want %q", decryptedBytes, plainBytes)
	}
}
