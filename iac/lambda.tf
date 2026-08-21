# lambda

resource "aws_lambda_function" "api" {
  function_name = local.lambda_function_api_name
  role          = aws_iam_role.api.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  timeout       = 10
  memory_size   = 256

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.pins.name
    }
  }

  depends_on = [
    aws_iam_role_policy.api,
    aws_cloudwatch_log_group.api,
  ]
}
