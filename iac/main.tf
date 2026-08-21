# main

resource "random_id" "suffix" {
  byte_length = 3
}

module "app" {
  source = "github.com/jimmy-ao/terraform_aws_module-static-website?ref=v0.1.3"

  providers = {
    aws.r53  = aws.r53
    aws.use1 = aws.acm
  }

  project     = var.project
  environment = var.environment

  app    = var.app
  domain = "archnops.com"

  cloudfront_index_document = "index.html"
  cloudfront_error_document = "error.html"
  cloudfront_price_class    = "PriceClass_100"

  cloudfront_content_security_policy_directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://cognito-idp.${var.region_main}.amazonaws.com https://*.execute-api.${var.region_main}.amazonaws.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ]

  logging = {
    enabled = false
  }

  analyzing = {
    enabled = false
  }

  waf = {
    enabled = false
  }
}