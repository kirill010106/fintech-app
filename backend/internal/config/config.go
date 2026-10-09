package config

import (
	"log"
	"os"
	"time"

	"github.com/ilyakaznacheev/cleanenv"
)

type Config struct {
	Env             string        `yaml:"env" env:"ENV" env-default:"local"`
	StoragePath     string        `yaml:"storage_path" env:"DATABASE_URL" env-default:"postgres://postgres:postgres@localhost:5432/vtb_family?sslmode=disable"`
	AppSecret       string        `yaml:"app_secret" env:"APP_SECRET" env-default:"vtb-family-shield-secret-key-2026"`
	AccessTokenTTL  time.Duration `yaml:"access_token_ttl" env:"ACCESS_TOKEN_TTL" env-default:"24h"`
	RefreshTokenTTL time.Duration `yaml:"refresh_token_ttl" env:"REFRESH_TOKEN_TTL" env-default:"168h"`
	HTTPServer      HTTPServer    `yaml:"http_server"`
}

type HTTPServer struct {
	Address     string        `yaml:"address" env:"HTTP_ADDRESS" env-default:":8080"`
	Timeout     time.Duration `yaml:"timeout" env:"HTTP_TIMEOUT" env-default:"10s"`
	IdleTimeout time.Duration `yaml:"idle_timeout" env:"HTTP_IDLE_TIMEOUT" env-default:"60s"`
	ClientURL   string        `yaml:"client_url" env:"CLIENT_URL" env-default:"http://localhost:5173"`
}

func MustLoad() *Config {
	var cfg Config

	configPath := os.Getenv("CONFIG_PATH")
	if configPath != "" {
		if _, err := os.Stat(configPath); err == nil {
			if err := cleanenv.ReadConfig(configPath, &cfg); err != nil {
				log.Fatalf("cannot read config %s: %s", configPath, err)
			}
			return &cfg
		}
	}

	if err := cleanenv.ReadEnv(&cfg); err != nil {
		log.Fatalf("cannot read env config: %s", err)
	}

	return &cfg
}
