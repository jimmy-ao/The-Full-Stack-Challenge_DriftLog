# providers


# provider used to deploy
provider "aws" {
  region  = var.region_main
  profile = "Hackathons"

  default_tags {
    tags = {
      Project   = "DriftLog"
      Stack     = local.app
      ManagedBy = "Terraform"
    }
  }
}

# provider used to create the certificate
provider "aws" {
  alias   = "acm"
  region  = "us-east-1"
  profile = "Hackathons"

  default_tags {
    tags = {
      Project   = "DriftLog"
      Stack     = local.app
      ManagedBy = "Terraform"
    }
  }
}

# provider used to handle route53 resources
provider "aws" {
  alias   = "r53"
  region  = "us-east-1"
  profile = "archnops"

  default_tags {
    tags = {
      Project   = "DriftLog"
      Stack     = local.app
      ManagedBy = "Terraform"
    }
  }
}