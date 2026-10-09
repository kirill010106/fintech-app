package services

import (
	"sync"
	"time"
)

type EventType string

const (
	EventCoSignCreated  EventType = "co_sign_created"
	EventCoSignResolved EventType = "co_sign_resolved"
	EventBalanceUpdated EventType = "balance_updated"
	EventGoalUpdated    EventType = "goal_updated"
	EventQuestCompleted EventType = "quest_completed"
)

type AppEvent struct {
	Type      EventType `json:"type"`
	UserID    int64     `json:"user_id,omitempty"`   // Target user ID (0 = all in family)
	FamilyID  int64     `json:"family_id,omitempty"` // Target family ID
	Payload   any       `json:"payload"`
	CreatedAt time.Time `json:"created_at"`
}

type EventClient struct {
	UserID   int64
	FamilyID int64
	SendChan chan AppEvent
}

type EventBroker struct {
	mu      sync.RWMutex
	clients map[*EventClient]bool
}

func NewEventBroker() *EventBroker {
	return &EventBroker{
		clients: make(map[*EventClient]bool),
	}
}

func (b *EventBroker) Subscribe(userID, familyID int64) *EventClient {
	b.mu.Lock()
	defer b.mu.Unlock()

	client := &EventClient{
		UserID:   userID,
		FamilyID: familyID,
		SendChan: make(chan AppEvent, 64),
	}
	b.clients[client] = true
	return client
}

func (b *EventBroker) Unsubscribe(client *EventClient) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if _, ok := b.clients[client]; ok {
		delete(b.clients, client)
		close(client.SendChan)
	}
}

func (b *EventBroker) Publish(event AppEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now()
	}

	for client := range b.clients {
		// Filter by UserID if target is specified
		if event.UserID != 0 && client.UserID != event.UserID {
			continue
		}
		// Filter by FamilyID if target is specified
		if event.FamilyID != 0 && client.FamilyID != event.FamilyID {
			continue
		}

		select {
		case client.SendChan <- event:
		default:
			// Buffer full, drop non-blocking to prevent stalling broker
		}
	}
}
