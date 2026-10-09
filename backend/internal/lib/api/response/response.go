package resp

import (
	"fmt"
	"strings"

	"github.com/go-playground/validator/v10"
)

type Response struct {
	Status           string            `json:"status"`
	Code             string            `json:"code,omitempty"`
	Error            string            `json:"error,omitempty"`
	ValidationErrors map[string]string `json:"validation_errors,omitempty"`
	Data             any               `json:"data,omitempty"`
}

const (
	StatusOK    = "OK"
	StatusError = "Error"
)

func OK() Response {
	return Response{
		Status: StatusOK,
	}
}

func OKWithData(data any) Response {
	return Response{
		Status: StatusOK,
		Data:   data,
	}
}

func Error(msg string) Response {
	return Response{
		Status: StatusError,
		Error:  msg,
	}
}

func ErrorCode(msg string, code string) Response {
	return Response{
		Status: StatusError,
		Code:   code,
		Error:  msg,
	}
}

func ValidationError(errs validator.ValidationErrors) Response {
	errMsgs := make(map[string]string)

	for _, err := range errs {
		field := strings.ToLower(err.Field())
		switch err.ActualTag() {
		case "required":
			errMsgs[field] = fmt.Sprintf("field %s is required", field)
		case "email":
			errMsgs[field] = fmt.Sprintf("field %s must be a valid email", field)
		case "min":
			errMsgs[field] = fmt.Sprintf("field %s must be at least %s characters", field, err.Param())
		case "max":
			errMsgs[field] = fmt.Sprintf("field %s must be at most %s characters", field, err.Param())
		default:
			errMsgs[field] = fmt.Sprintf("field %s is invalid", field)
		}
	}

	return Response{
		Status:           StatusError,
		Error:            "validation error",
		ValidationErrors: errMsgs,
	}
}
