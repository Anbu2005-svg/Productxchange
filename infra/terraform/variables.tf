variable "aws_region" {
  default = "ap-south-1"
}

variable "project_name" {
  default = "productxchange"
}

variable "environment" {
  default = "production"
}

variable "db_username" {
  default = "productxchange"
}

variable "db_password" {
  description = "Set via TF_VAR_db_password or a secrets manager — never commit a real value."
  sensitive   = true
}

variable "db_instance_class" {
  default = "db.t4g.micro" # bump to db.t4g.small+ once you have real traffic
}

variable "backend_image" {
  description = "ECR image URI for the backend, set by CI after build+push"
  default     = ""
}

variable "frontend_image" {
  description = "ECR image URI for the frontend, set by CI after build+push"
  default     = ""
}

variable "jwt_secret" {
  sensitive = true
}
