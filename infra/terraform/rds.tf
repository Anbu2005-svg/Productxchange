# Database stays private — only reachable from the backend's security group, never public.

resource "aws_security_group" "db" {
  name_prefix = "${var.project_name}-db-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-db-subnets"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.project_name}-${var.environment}"
  engine                 = "postgres"
  engine_version         = "16.4" # RDS PostgreSQL 16 supports the postgis extension
  instance_class         = var.db_instance_class
  allocated_storage      = 20
  max_allocated_storage  = 100
  db_name                = "productxchange"
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.project_name}-final-snapshot"
  backup_retention_period   = 7
  deletion_protection       = true

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# After the instance is up, connect once and run:
#   CREATE EXTENSION IF NOT EXISTS postgis;
#   CREATE EXTENSION IF NOT EXISTS vector;
# (Alembic's initial migration does this automatically on first `alembic upgrade head`
# against this instance, as long as the DB user has rds_superuser — RDS grants this by default.)
