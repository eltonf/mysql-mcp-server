# Testing

Run local checks:

```bash
npm install
npm run build
npm test
```

## Optional MySQL Integration Test

Start a local MySQL instance:

```bash
docker run --name mysql-mcp-test \
  -e MYSQL_ROOT_PASSWORD=root_password \
  -e MYSQL_DATABASE=app_db \
  -e MYSQL_USER=mcp_reader \
  -e MYSQL_PASSWORD=change_me \
  -p 3306:3306 \
  -d mysql:8
```

Create sample tables:

```sql
CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

Configure `.env` with `DB_NAME=app_db`, then run:

```bash
npm run build
npm start
```

Use an MCP client to call `get_schema`, `find_tables`, `get_relationships`, and, when access control is configured, `execute_query`.
