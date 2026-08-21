# versions

terraform {
  required_version = ">= 1.15"

  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 6.0"
      configuration_aliases = [aws.r53, aws.acm]
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}