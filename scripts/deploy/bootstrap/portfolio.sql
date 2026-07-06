-- Bootstrap the dedicated PostgreSQL role and database for the portfolio app.
-- Replace <strong-password> before applying this in production.

CREATE ROLE portfolio_app LOGIN PASSWORD '<strong-password>';
CREATE DATABASE portfolio OWNER portfolio_app;
