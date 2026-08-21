output "app_url" {
  description = "Open this. It is the deployed DriftLog."
  value       = module.app.website_url
}

output "region" {
  description = "Region the stack was deployed into."
  value       = var.region_main
}

output "api_endpoint" {
  description = "Base URL of the HTTP API."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "cognito_user_pool_id" {
  description = "Cognito user pool holding DriftLog accounts."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  description = "Public app client id used by the browser."
  value       = aws_cognito_user_pool_client.web.id
}

output "dynamodb_table" {
  description = "Single table storing every pin."
  value       = aws_dynamodb_table.pins.name
}

output "web_bucket" {
  description = "Private S3 bucket behind CloudFront, managed by the static-website module."
  value       = module.app.web_bucket_id
}

output "cloudfront_distribution_id" {
  description = "Use with `aws cloudfront create-invalidation` if you need to bust the cache early."
  value       = module.app.cloudfront_id
}
