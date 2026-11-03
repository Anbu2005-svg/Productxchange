output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "db_endpoint" {
  value     = aws_db_instance.postgres.endpoint
  sensitive = true
}

output "uploads_bucket" {
  value = aws_s3_bucket.uploads.bucket
}
