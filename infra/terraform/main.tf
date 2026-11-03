# Minimal AWS skeleton: VPC, private RDS (PostGIS), S3, ECR, ECS Fargate cluster.
# Review and extend (ALB, target groups, task definitions, secrets) before applying.
terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
}
provider "aws" { region = var.region }

variable "region"      { default = "ap-south-1" }
variable "db_password" { sensitive = true }

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  name    = "productxchange"
  cidr    = "10.0.0.0/16"
  azs     = ["${var.region}a", "${var.region}b"]
  public_subnets   = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets  = ["10.0.11.0/24", "10.0.12.0/24"]
  enable_nat_gateway = true
  single_nat_gateway = true
}

resource "aws_security_group" "db" {
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port = 5432
    to_port   = 5432
    protocol  = "tcp"
    cidr_blocks = [module.vpc.vpc_cidr_block] # private access only
  }
}

resource "aws_db_subnet_group" "main" { subnet_ids = module.vpc.private_subnets }

resource "aws_db_instance" "postgres" {
  identifier             = "productxchange"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  db_name                = "productxchange"
  username               = "productxchange"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  backup_retention_period = 7
  skip_final_snapshot    = false
  final_snapshot_identifier = "productxchange-final"
}
# RDS supports PostGIS and pgvector; enable via CREATE EXTENSION (done by Alembic migration 0001).

resource "aws_s3_bucket" "uploads" { bucket = "productxchange-uploads-${data.aws_caller_identity.me.account_id}" }
resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  block_public_acls = true
  block_public_policy = false
  ignore_public_acls = true
  restrict_public_buckets = false
}
data "aws_caller_identity" "me" {}

resource "aws_ecr_repository" "backend"  { name = "productxchange-backend" }
resource "aws_ecr_repository" "frontend" { name = "productxchange-frontend" }
resource "aws_ecs_cluster" "main" { name = "productxchange" }

output "db_endpoint"  { value = aws_db_instance.postgres.endpoint }
output "uploads_bucket" { value = aws_s3_bucket.uploads.bucket }
