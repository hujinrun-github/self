package db

import (
	"reflect"
	"testing"
)

func TestSplitSQLStatements(t *testing.T) {
	sqlText := `
CREATE TABLE example (value TEXT);
INSERT INTO example (value) VALUES ('a;b');
-- comment with ; stays attached
INSERT INTO example (value) VALUES ('c');
`

	got, err := splitSQLStatements(sqlText)
	if err != nil {
		t.Fatalf("splitSQLStatements: %v", err)
	}
	want := []string{
		"CREATE TABLE example (value TEXT)",
		"INSERT INTO example (value) VALUES ('a;b')",
		"-- comment with ; stays attached\nINSERT INTO example (value) VALUES ('c')",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("statements = %#v, want %#v", got, want)
	}
}

func TestSplitSQLStatementsRejectsUnterminatedSingleQuote(t *testing.T) {
	_, err := splitSQLStatements("INSERT INTO example (value) VALUES ('oops);")
	if err == nil {
		t.Fatal("expected unterminated single-quoted string error")
	}
}
