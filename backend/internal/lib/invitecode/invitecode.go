// Package invitecode generates short, human-friendly family invite codes.
package invitecode

import (
	"crypto/rand"
	"math/big"
)

// alphabet excludes visually ambiguous characters (O/0, I/1) so codes can be
// dictated over the phone or written down without mistakes.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// Length is the fixed length of every generated invite code.
const Length = 6

// Generate returns a cryptographically random invite code of Length characters.
func Generate() (string, error) {
	code := make([]byte, Length)
	max := big.NewInt(int64(len(alphabet)))
	for i := range code {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		code[i] = alphabet[idx.Int64()]
	}
	return string(code), nil
}
