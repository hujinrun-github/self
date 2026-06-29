package i18n

import (
	"reflect"
	"testing"
)

func TestCoerceLocaleFallsBackToZh(t *testing.T) {
	if got := CoerceLocale("fr"); got != LocaleZH {
		t.Fatalf("locale = %q, want %q", got, LocaleZH)
	}
	if got := CoerceLocale("ja"); got != LocaleJA {
		t.Fatalf("locale = %q, want %q", got, LocaleJA)
	}
}

func TestFallbackOrder(t *testing.T) {
	cases := map[Locale][]Locale{
		LocaleZH: {LocaleZH},
		LocaleEN: {LocaleEN, LocaleZH},
		LocaleJA: {LocaleJA, LocaleEN, LocaleZH},
	}

	for locale, want := range cases {
		t.Run(string(locale), func(t *testing.T) {
			if got := FallbackOrder(locale); !reflect.DeepEqual(got, want) {
				t.Fatalf("fallback order = %#v, want %#v", got, want)
			}
		})
	}
}

func TestParseTranslationLocaleRejectsZhAndUnknown(t *testing.T) {
	if _, err := ParseTranslationLocale("zh"); err == nil {
		t.Fatal("expected zh translation locale to be rejected")
	}
	if _, err := ParseTranslationLocale("fr"); err == nil {
		t.Fatal("expected unknown translation locale to be rejected")
	}
	if locale, err := ParseTranslationLocale("en"); err != nil || locale != LocaleEN {
		t.Fatalf("locale = %q err = %v", locale, err)
	}
}
