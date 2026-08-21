# cloudwatch

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.cloudwatch_log_group_api_name}"
  retention_in_days = var.log_retention_days
}