package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"golang.design/x/clipboard"
)

// App struct
type App struct {
	ctx            context.Context
	logMutex       sync.Mutex
	clipboardReady bool
	clipboardError string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called at application startup
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	if err := clipboard.Init(); err != nil {
		a.clipboardError = err.Error()
		return
	}

	a.clipboardReady = true
}

// domReady is called after front-end resources have been loaded
func (a App) domReady(ctx context.Context) {
	// Add your action here
}

// beforeClose is called when the application is about to quit,
// either by clicking the window close button or calling runtime.Quit.
// Returning true will cause the application to continue, false will continue shutdown as normal.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	return false
}

// shutdown is called at application termination
func (a *App) shutdown(ctx context.Context) {
	// Perform your teardown here
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
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
	// Writing the log file with the mutex to prevent condition race
	a.logMutex.Lock()
	defer a.logMutex.Unlock()

	entry := fmt.Sprintf(
		"%s | %s | %s | %s\n",
		sanitizeLogValue(level),
		sanitizeLogValue(message),
		sanitizeLogValue(target),
		time.Now().Format(time.RFC3339),
	)

	file, err := os.OpenFile(".log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
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
			return "", fmt.Errorf(a.clipboardError)
		}
		return "", fmt.Errorf("clipboard unavailable")
	}

	text := clipboard.Read(clipboard.FmtText)
	if len(text) == 0 {
		return "", nil
	}

	return string(text), nil
}
