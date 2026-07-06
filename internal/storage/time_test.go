package storage

import (
	"testing"
	"time"
)

func TestNormalizeTime(t *testing.T) {
	location := time.FixedZone("test", 8*60*60)
	value := time.Date(2026, 6, 17, 8, 9, 10, 123456789, location)

	got := NormalizeTime(value)
	want := time.Date(2026, 6, 17, 0, 9, 10, 123456000, time.UTC)
	if !got.Equal(want) || got.Location() != time.UTC {
		t.Fatalf("NormalizeTime() = %v (%v), want %v UTC", got, got.Location(), want)
	}
}

func TestTimePtrValue(t *testing.T) {
	if got := TimePtrValue(nil); got != nil {
		t.Fatalf("TimePtrValue(nil) = %v, want nil", got)
	}

	value := time.Date(2026, 6, 17, 8, 9, 10, 123456789, time.FixedZone("test", 8*60*60))
	got, ok := TimePtrValue(&value).(time.Time)
	if !ok {
		t.Fatalf("TimePtrValue(non-nil) type = %T, want time.Time", got)
	}
	if got.Nanosecond() != 123456000 || got.Location() != time.UTC {
		t.Fatalf("TimePtrValue(non-nil) = %v (%v), want UTC microsecond precision", got, got.Location())
	}
}
