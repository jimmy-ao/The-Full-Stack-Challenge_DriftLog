variable "region_main" {
  description = "AWS region for every regional resource in the stack."
  type        = string
  default     = "eu-north-1"
}

variable "region_alt" {
  description = "AWS region for specific regional resource in the stack, such as certificates or dns."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name of the project these resources belong to."
  type        = string
  default     = "aws-the-full-stack-challenge"

  validation {
    condition     = can(regex("^[a-z0-9-]{3,30}$", var.project))
    error_message = "project must be 3-30 characters of lowercase letters, numbers or hyphens."
  }
}

variable "app" {
  description = "Short slug used to name resources. Lowercase letters, numbers and hyphens."
  type        = string
  default     = "driftlog"

  validation {
    condition     = can(regex("^[a-z0-9-]{3,20}$", var.app))
    error_message = "app must be 3-20 characters of lowercase letters, numbers or hyphens."
  }
}

variable "environment" {
  type        = string
  description = "Name of the environment these resources belong to."
  nullable    = false
  default     = "sbx"

  validation {
    condition     = contains(["prd", "npe", "uat", "lab", "tst", "sbx"], var.environment)
    error_message = "The environment must be one of: prd, npe, uat, lab, tst, sbx."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the API Lambda."
  type        = number
  default     = 14
}

variable "cloudfront_price_class" {
  description = "CloudFront price class. PriceClass_100 is the cheapest (NA + EU)."
  type        = string
  default     = "PriceClass_100"
}

variable "point_in_time_recovery" {
  description = "Enable DynamoDB point-in-time recovery. Costs a little; worth it for real data."
  type        = bool
  default     = false
}
