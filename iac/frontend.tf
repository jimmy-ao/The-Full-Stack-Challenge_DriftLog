# Static site: private S3 bucket, reachable only through CloudFront via an
# Origin Access Control. Terraform also uploads the site, so `terraform apply`
# is the entire deploy — there is no separate sync step to forget.

# resource "aws_s3_bucket" "web" {
#   bucket        = "${local.app_unique}-web"
#   force_destroy = true
# }

# resource "aws_s3_bucket_public_access_block" "web" {
#   bucket                  = aws_s3_bucket.web.id
#   block_public_acls       = true
#   block_public_policy     = true
#   ignore_public_acls      = true
#   restrict_public_buckets = true
# }

# resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
#   bucket = aws_s3_bucket.web.id

#   rule {
#     apply_server_side_encryption_by_default {
#       sse_algorithm = "AES256"
#     }
#   }
# }

# resource "aws_s3_bucket_versioning" "web" {
#   bucket = aws_s3_bucket.web.id

#   versioning_configuration {
#     status = "Enabled"
#   }
# }

# resource "aws_cloudfront_origin_access_control" "web" {
#   name                              = "${local.app_unique}-oac"
#   origin_access_control_origin_type = "s3"
#   signing_behavior                  = "always"
#   signing_protocol                  = "sigv4"
# }

# resource "aws_cloudfront_response_headers_policy" "web" {
#   name = "${local.app_unique}-headers"

#   security_headers_config {
#     content_type_options {
#       override = true
#     }

#     frame_options {
#       frame_option = "DENY"
#       override     = true
#     }

#     referrer_policy {
#       referrer_policy = "strict-origin-when-cross-origin"
#       override        = true
#     }

#     strict_transport_security {
#       access_control_max_age_sec = 31536000
#       include_subdomains         = true
#       override                   = true
#     }
#   }
# }

# resource "aws_cloudfront_distribution" "web" {
#   enabled             = true
#   is_ipv6_enabled     = true
#   comment             = "DriftLog ${var.environment}"
#   default_root_object = "index.html"
#   price_class         = var.cloudfront_price_class

#   origin {
#     domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
#     origin_id                = "s3-web"
#     origin_access_control_id = aws_cloudfront_origin_access_control.web.id
#   }

#   default_cache_behavior {
#     target_origin_id       = "s3-web"
#     viewer_protocol_policy = "redirect-to-https"
#     allowed_methods        = ["GET", "HEAD", "OPTIONS"]
#     cached_methods         = ["GET", "HEAD"]
#     compress               = true

#     # Managed-CachingOptimized: honours the Cache-Control we set per object.
#     cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
#     response_headers_policy_id = aws_cloudfront_response_headers_policy.web.id
#   }

#   # Single-page app: unknown paths fall back to the shell.
#   custom_error_response {
#     error_code            = 403
#     response_code         = 200
#     response_page_path    = "/index.html"
#     error_caching_min_ttl = 10
#   }

#   custom_error_response {
#     error_code            = 404
#     response_code         = 200
#     response_page_path    = "/index.html"
#     error_caching_min_ttl = 10
#   }

#   restrictions {
#     geo_restriction {
#       restriction_type = "none"
#     }
#   }

#   viewer_certificate {
#     cloudfront_default_certificate = true
#   }
# }

# data "aws_iam_policy_document" "web_bucket" {
#   statement {
#     sid       = "AllowCloudFrontRead"
#     effect    = "Allow"
#     actions   = ["s3:GetObject"]
#     resources = ["${aws_s3_bucket.web.arn}/*"]

#     principals {
#       type        = "Service"
#       identifiers = ["cloudfront.amazonaws.com"]
#     }

#     condition {
#       test     = "StringEquals"
#       variable = "AWS:SourceArn"
#       values   = [aws_cloudfront_distribution.web.arn]
#     }
#   }
# }

# resource "aws_s3_bucket_policy" "web" {
#   bucket = aws_s3_bucket.web.id
#   policy = data.aws_iam_policy_document.web_bucket.json

#   depends_on = [aws_s3_bucket_public_access_block.web]
# }

# ----------------------------- site upload -----------------------------

locals {
  web_dir = "${path.module}/../web"

  # Everything except the config, which is rendered from a template below.
  # A locally generated config.js (used for `npm`-free local dev) is excluded
  # so it can never collide with the generated object.
  web_files = setsubtract(fileset(local.web_dir, "**"), ["config.js.tftpl", "config.js"])

  mime_types = {
    html        = "text/html; charset=utf-8"
    css         = "text/css; charset=utf-8"
    js          = "application/javascript; charset=utf-8"
    json        = "application/json"
    svg         = "image/svg+xml"
    png         = "image/png"
    jpg         = "image/jpeg"
    ico         = "image/x-icon"
    webmanifest = "application/manifest+json"
    txt         = "text/plain; charset=utf-8"
  }

  # The shell and the config must never be served stale after a redeploy.
  no_cache_files = ["index.html", "config.js"]
}

resource "aws_s3_object" "web" {
  for_each = local.web_files

  bucket       = module.app.web_bucket_id
  key          = each.value
  source       = "${local.web_dir}/${each.value}"
  etag         = filemd5("${local.web_dir}/${each.value}")
  content_type = lookup(local.mime_types, lower(reverse(split(".", each.value))[0]), "application/octet-stream")

  cache_control = contains(local.no_cache_files, each.value) ? "no-cache, max-age=0, must-revalidate" : "public, max-age=60"
}

# config.js carries the deployed resource ids into the browser. It is generated
# rather than committed, so nobody has to paste a user pool id by hand.
resource "aws_s3_object" "config" {
  bucket        = module.app.web_bucket_id
  key           = "config.js"
  content_type  = "application/javascript; charset=utf-8"
  cache_control = "no-cache, max-age=0, must-revalidate"

  content = templatefile("${local.web_dir}/config.js.tftpl", {
    region       = var.region_main
    user_pool_id = aws_cognito_user_pool.main.id
    client_id    = aws_cognito_user_pool_client.web.id
    api_endpoint = aws_apigatewayv2_stage.default.invoke_url
  })
}
