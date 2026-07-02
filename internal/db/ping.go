package db

import "context"

func Ping(ctx context.Context, databaseURL string) error {
	database, err := openDatabase(databaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	return pingDatabase(ctx, database)
}
